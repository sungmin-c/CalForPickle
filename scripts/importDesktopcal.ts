// One-time import of CalendarTask (desktopcal) day cells into tasks. Pure functions; the CLI is importDesktopcal.cli.ts.
import { mergeItems } from "../src/merge";
import { ordered, seoulStamp, type Event, type Status, type Task } from "../src/model";

/** Fixed namespace: changing it changes every imported id. */
export const IMPORT_NS = "96664484-7fe3-442b-9010-0f971d98dad1";

// Before 2026 the source app's done mark ([+]) was never used, so an unmarked old line does not mean "not done".
const DONE_MARK_SINCE = "2026-01-01";
const DONE = /^\s*\[\+\]/;
const ENTITIES: Record<string, string> = { gt: ">", lt: "<", quot: '"', "#039": "'", amp: "&" };

export interface CellRow {
  key: string; // dkcal_mdays_YYYYMMDD
  content: string;
  cdate: string; // YYYY-MM-DD HH:MM:SS, local wall clock
  mdate: string;
}

export async function uuidV5(name: string, ns: string): Promise<string> {
  const nsBytes = Uint8Array.from(ns.replace(/-/g, "").match(/../g)!, (h) => parseInt(h, 16));
  const data = new Uint8Array([...nsBytes, ...new TextEncoder().encode(name)]);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** The source app stores Seoul wall-clock time without an offset. */
export function localStamp(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(v);
  if (!m) throw new Error("bad timestamp");
  return `${m[1]}T${m[2]}.000+09:00`;
}

/** Source escapes entities as |&gt;| etc. Each token is replaced once, so "|&amp;|gt;" cannot double-decode. */
export function cleanTitle(line: string): string {
  return line
    .replace(DONE, "")
    .replace(/\|&(gt|lt|quot|#039|amp);\|/g, (_, e: string) => ENTITIES[e])
    .trim();
}

const FONT = /^\s*<font color="(#[0-9A-Fa-f]{6})">([\s\S]*)<\/font>\s*$/;

/** The source app colors a whole title by wrapping it in one <font color>; that becomes the color key (session 9). Partial or other markup stays as typed. */
export function fontColor(title: string): { title: string; color?: string } {
  const m = FONT.exec(title);
  return m && !/<\/?font/.test(m[2]) ? { title: m[2].trim(), color: m[1].toUpperCase() } : { title };
}

export const statusFor = (marked: boolean, due: string): Status =>
  marked || due < DONE_MARK_SINCE ? "done" : "todo";

/** One task per non-blank line. Throws on a malformed cell key or timestamp. */
export async function cellTasks(row: CellRow): Promise<Task[]> {
  const ymd = /^dkcal_mdays_(\d{4})(\d{2})(\d{2})$/.exec(row.key);
  if (!ymd) throw new Error("bad cell key");
  const due = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const updatedAt = localStamp(row.mdate > row.cdate ? row.mdate : row.cdate);
  const seen = new Map<string, number>();
  const out: Task[] = [];
  for (const line of row.content.split(/\r\n|\n|\r/)) {
    const { title, color } = fontColor(cleanTitle(line));
    if (!title) continue;
    // Keyed on date + raw body, not line index: the source moves done lines to the cell end.
    const body = line.replace(DONE, "").trim();
    const n = (seen.get(body) ?? 0) + 1;
    seen.set(body, n);
    const name = `dkcal:${ymd[1]}${ymd[2]}${ymd[3]}:${body}${n > 1 ? `:${n}` : ""}`;
    out.push({
      id: await uuidV5(name, IMPORT_NS),
      title,
      ...(color && { color }),
      status: statusFor(DONE.test(line), due),
      due,
      notes: "",
      updatedAt,
      deleted: false,
    });
  }
  return out;
}

export function monthCounts(tasks: Task[]): [string, Record<string, number>][] {
  const m = new Map<string, Record<string, number>>();
  for (const t of tasks) {
    const k = (t.due ?? "none").slice(0, 7);
    const c = m.get(k) ?? { todo: 0, done: 0 };
    c[t.status] = (c[t.status] ?? 0) + 1;
    m.set(k, c);
  }
  return [...m].sort(([a], [b]) => (a < b ? -1 : 1));
}

/** Same LWW as sync (mergeItems), plus what happened to each imported id. */
export function planMerge(local: Task[], imported: Task[]) {
  const byId = new Map(local.map((t) => [t.id, t]));
  const text = (t: Task) => JSON.stringify(ordered(t));
  const counts = { added: 0, updated: 0, unchanged: 0, keptLocal: 0 };
  for (const t of imported) {
    const prev = byId.get(t.id);
    if (!prev) counts.added++;
    else if (text(prev) === text(t)) counts.unchanged++;
    else if (mergeItems([prev], [t])[0] === t) counts.updated++;
    else counts.keptLocal++;
  }
  return { merged: mergeItems(local, imported), counts };
}

export interface EventRow {
  uid: string; // ev_unique_id
  content: string;
  start: string; // 2025-09-27T00:00:00.000+0900
  status: number;
  rec: string; // {"RRULE":{FREQ, BYWEEK, BYMONTHDAY, BYMONTH, UNTIL, COUNT}}
  info: string; // entity-escaped JSON; DELDATE is the one removed occurrence
  cdate: string; // UTC ISO
  mdate: string;
}

// Source key → RRULE key, in the order they are written.
const RULE_KEYS: [string, string][] = [["FREQ", "FREQ"], ["BYMONTH", "BYMONTH"], ["BYMONTHDAY", "BYMONTHDAY"], ["BYWEEK", "BYDAY"], ["COUNT", "COUNT"], ["UNTIL", "UNTIL"]];

/** One source event as an all-day series (R1~R6, session 7). Status 2 events are skipped (R6); meaning unknown, user chose to drop them. */
export async function sourceEvent(row: EventRow): Promise<Event | null> {
  if (row.status === 2) return null;
  const rule = (JSON.parse(row.rec) as { RRULE: Record<string, string | number> }).RRULE;
  const unknown = Object.keys(rule).filter((k) => !RULE_KEYS.some(([src]) => src === k));
  if (unknown.length) throw new Error(`unknown rule keys ${unknown.join(",")}`);
  const recurrence = RULE_KEYS.filter(([src]) => rule[src] !== undefined)
    .map(([src, dst]) => `${dst}=${src === "UNTIL" ? String(rule[src]).slice(0, 8) : rule[src]}`) // R3: date only, inclusive
    .join(";");
  const day = /^(\d{4}-\d{2}-\d{2})T/.exec(row.start)?.[1];
  if (!day) throw new Error("bad start");
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
  const info = JSON.parse(cleanTitle(row.info)) as { DELDATE?: string };
  const del = /^(\d{4})(\d{2})(\d{2})$/.exec(info.DELDATE ?? "");
  const stamp = (v: string) => Date.parse(v);
  const e: Event = {
    id: await uuidV5(`dkcal-ev:${row.uid}`, IMPORT_NS),
    ...fontColor(cleanTitle(row.content)),
    start: day,
    end: next,
    allDay: true,
    recurrence,
    location: "",
    notes: "",
    updatedAt: seoulStamp(Math.max(stamp(row.cdate), stamp(row.mdate))),
    deleted: false,
  };
  if (del) e.exdates = [`${del[1]}-${del[2]}-${del[3]}`];
  return e;
}
