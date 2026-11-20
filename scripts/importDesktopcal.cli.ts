// Usage (bundle first, src/ uses extensionless imports):
//   npx rolldown scripts/importDesktopcal.cli.ts -o <tmp>/import.mjs -p node -f esm
//   node <tmp>/import.mjs <copy of calendar.db> [--write]
// Default is a dry run. Prints counts only, never titles. --write touches %APPDATA%\CalForPickle only, never the network.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mergeItems } from "../src/merge";
import { parseEvents, parseTasks, serializeEvents, serializeTasks, type Event, type Task } from "../src/model";
import { EVENTS_DIR, partition } from "../src/partition";
import { cellTasks, monthCounts, planMerge, sourceEvent, type CellRow, type EventRow } from "./importDesktopcal";

const TASKS_PATH = "data/tasks.json"; // same as src/sync.ts (not imported: it pulls in Tauri)
const STATE_PATH = "sync-state.json";
const MAX_FILE = 1024 * 1024; // Contents API base64 limit (DESIGN §7.3)

const [dbPath, flag] = process.argv.slice(2);
if (!dbPath) throw new Error("usage: import.mjs <db copy> [--write]");
const write = flag === "--write";
const root = join(process.env.APPDATA!, "CalForPickle");
const shape = (s: string) => s.replace(/\d/g, "9").replace(/[A-Za-z]/g, "a").replace(/[^\x00-\x7f]/g, "#").slice(0, 30);
const nonEmpty = (v: unknown) => typeof v === "string" && v !== "" && v !== "[]";

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db
  .prepare(
    "select it_unique_id key, it_content content, it_cdate cdate, it_mdate mdate, it_bgcolor bg, it_history hist, it_appinfo app, group_id grp from item_table order by it_unique_id",
  )
  .all() as unknown as (CellRow & Record<string, unknown>)[];
const evRows = db
  .prepare(
    "select ev_unique_id uid, ev_content content, ev_start_date start, ev_status status, ev_recurrence rec, ev_info info, ev_cdate cdate, ev_mdate mdate from event_table order by ev_unique_id",
  )
  .all() as unknown as EventRow[];
db.close();

async function convert() {
  const tasks: Task[] = [];
  const failures: string[] = [];
  let rawLines = 0;
  for (const r of rows) {
    rawLines += (r.content ?? "").split(/\r\n|\n|\r/).filter((l) => l.trim()).length;
    try {
      tasks.push(...(await cellTasks({ ...r, content: r.content ?? "" })));
    } catch (e) {
      failures.push(`${shape(String(r.key))} ${(e as Error).message}`);
    }
  }
  return { tasks, failures, rawLines };
}

const { tasks, failures, rawLines } = await convert();
const again = (await convert()).tasks;
const ids = new Set(tasks.map((t) => t.id));

const localText = existsSync(join(root, TASKS_PATH)) ? readFileSync(join(root, TASKS_PATH), "utf8") : null;
const local = localText ? parseTasks(localText) : [];
const { merged, counts } = planMerge(local, tasks);
const text = serializeTasks(merged);
const bytes = Buffer.byteLength(text);

// Events: status-2 rows are skipped (R6), the rest become all-day series merged LWW into local month files.
const events: Event[] = [];
for (const r of evRows) {
  try {
    const e = await sourceEvent(r);
    if (e) events.push(e);
  } catch (e) {
    failures.push(`event ${shape(r.uid)} ${(e as Error).message}`);
  }
}
const evDir = join(root, EVENTS_DIR);
const evFiles = existsSync(evDir) ? readdirSync(evDir).filter((f) => f.endsWith(".json")) : [];
const localEvents = evFiles.flatMap((f) => parseEvents(readFileSync(join(evDir, f), "utf8")));
const evText = new Map([...partition(mergeItems(localEvents, events))].map(([p, es]) => [p, serializeEvents(es)]));
const freq = new Map<string, number>();
for (const e of events) {
  const f = /FREQ=(\w+)/.exec(e.recurrence!)![1];
  freq.set(f, (freq.get(f) ?? 0) + 1);
}
const by = (s: string) => tasks.filter((t) => t.status === s).length;
const forcedDone = tasks.filter((t) => t.status === "done" && t.due! < "2026-01-01").length;

console.log(`== ${write ? "WRITE" : "DRY-RUN"} ==
cells ${rows.length}, non-blank lines ${rawLines}, tasks ${tasks.length} (lines blank after cleanup: ${rawLines - tasks.length})
status: done ${by("done")} (due before 2026, all done: ${forcedDone}), todo ${by("todo")}, deleted 0
events: ${events.length} of ${evRows.length} (skipped status 2: ${evRows.filter((r) => r.status === 2).length}; ${[...freq].map(([k, v]) => `${k} ${v}`).join(", ")}; with exdates ${events.filter((e) => e.exdates).length}; local before ${localEvents.length}) → ${[...evText.keys()].join(", ")}
ids unique: ${ids.size === tasks.length}, idempotent (2 runs byte-equal): ${serializeTasks(again) === serializeTasks(tasks)}
failures: ${failures.length}${failures.map((f) => `\n  - ${f}`).join("")}
by due month (todo/done):
${monthCounts(tasks)
  .map(([m, c]) => `  ${m}  ${c.todo}/${c.done}`)
  .join("\n")}
dropped fields: it_history (${rows.filter((r) => nonEmpty(r.hist)).length} cells), it_bgcolor (${rows.filter((r) => nonEmpty(r.bg)).length}), it_appinfo (${rows.filter((r) => nonEmpty(r.app)).length}), group_id (${rows.filter((r) => nonEmpty(r.grp)).length}), u_mid/it_stime/it_mtime (all rows; it_cdate only feeds updatedAt), ev_type and ev_info countdown/CMPEDATE (events)
local copy: ${localText === null ? "none" : `${local.length} tasks`} → added ${counts.added}, updated ${counts.updated}, unchanged ${counts.unchanged}, kept newer local ${counts.keptLocal}; result ${merged.length} tasks
tasks.json ${(bytes / 1024).toFixed(1)} KiB (limit 1024 KiB: ${bytes < MAX_FILE ? "ok" : "OVER"}), open tasks in upcoming.json: ${merged.filter((t) => !t.deleted && t.status !== "done").length}`);

if (write) {
  if (failures.length || ids.size !== tasks.length || bytes >= MAX_FILE) throw new Error("refusing to write: see report");
  const procs = execFileSync("tasklist", ["/FI", "IMAGENAME eq calforpickle.exe", "/NH"], { encoding: "utf8" });
  if (/calforpickle\.exe/i.test(procs)) throw new Error("CalForPickle is running; quit it (tray → 종료) first");
  const atomic = (rel: string, body: string) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p + ".tmp", body);
    renameSync(p + ".tmp", p);
  };
  const changed: string[] = [];
  if (text !== localText) (atomic(TASKS_PATH, text), changed.push(TASKS_PATH));
  for (const [p, body] of evText) {
    const prev = existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null;
    if (body !== prev) (atomic(p, body), changed.push(p));
  }
  const statePath = join(root, STATE_PATH);
  const st = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { files: {}, dirty: [] };
  for (const p of changed) if (!st.dirty.includes(p)) st.dirty.push(p);
  atomic(STATE_PATH, JSON.stringify(st, null, 2) + "\n");
  console.log(`wrote and marked dirty (no push): ${changed.join(", ") || "nothing changed"}`);
}
