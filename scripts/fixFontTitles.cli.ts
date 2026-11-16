// One-time cleanup (session 9): titles imported before fontColor existed still carry <font color>. Moves it to the color key.
// Usage: npx rolldown scripts/fixFontTitles.cli.ts -o <tmp>/fix.mjs -p node -f esm && node <tmp>/fix.mjs [--write]
// Default is a dry run. Prints counts only, never titles. Touches %APPDATA%\CalForPickle only, never the network.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nextStamp, parseEvents, parseTasks, serializeEvents, serializeTasks, type Event, type Task } from "../src/model";
import { EVENTS_DIR } from "../src/partition";
import { fontColor } from "./importDesktopcal";

const write = process.argv[2] === "--write";
const root = join(process.env.APPDATA!, "CalForPickle");
const now = new Date();

// Edited items get a fresh updatedAt so they win LWW against the repo and any later re-import.
function fix<T extends Event | Task>(items: T[]) {
  let n = 0;
  const out = items.map((it) => {
    const f = fontColor(it.title);
    if (!f.color) return it;
    n++;
    return { ...it, ...f, updatedAt: nextStamp(it.updatedAt, now) };
  });
  return { out, n };
}

const files: [string, string][] = [];
const report: string[] = [];
const tasksRel = "data/tasks.json";
const t = fix(parseTasks(readFileSync(join(root, tasksRel), "utf8")));
report.push(`${tasksRel}: ${t.n}`);
if (t.n) files.push([tasksRel, serializeTasks(t.out)]);
for (const f of readdirSync(join(root, EVENTS_DIR)).filter((f) => f.endsWith(".json"))) {
  const rel = `${EVENTS_DIR}/${f}`;
  const e = fix(parseEvents(readFileSync(join(root, rel), "utf8")));
  report.push(`${rel}: ${e.n}`);
  if (e.n) files.push([rel, serializeEvents(e.out)]);
}
const left = files.filter(([, body]) => /<\/?font\b/i.test(body)).map(([p]) => p);
console.log(`== ${write ? "WRITE" : "DRY-RUN"} ==\n${report.join("\n")}\nfiles to write: ${files.length}, <font> left after fix: ${left.length ? left.join(", ") : 0}`);

if (write && files.length) {
  if (left.length) throw new Error("refusing to write: tags left (partial or nested markup)");
  const procs = execFileSync("tasklist", ["/FI", "IMAGENAME eq calforpickle.exe", "/NH"], { encoding: "utf8" });
  if (/calforpickle\.exe/i.test(procs)) throw new Error("CalForPickle is running; quit it (tray → 종료) first");
  const atomic = (rel: string, body: string) => {
    const p = join(root, rel);
    writeFileSync(p + ".tmp", body);
    renameSync(p + ".tmp", p);
  };
  for (const [rel, body] of files) atomic(rel, body);
  const statePath = join(root, "sync-state.json");
  const st = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { files: {}, dirty: [] };
  for (const [rel] of files) if (!st.dirty.includes(rel)) st.dirty.push(rel);
  atomic("sync-state.json", JSON.stringify(st, null, 2) + "\n");
  console.log(`wrote and marked dirty (no push): ${files.map(([p]) => p).join(", ")}`);
}
