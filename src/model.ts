import { parseRule } from "./recur";

export type Status = "todo" | "doing" | "done";
export type Priority = "high" | "normal" | "low";

export interface Event {
  id: string;
  title: string;
  color?: string; // "#RRGGBB", shown as a dot before the title
  start: string;
  end: string;
  allDay: boolean;
  recurrence?: string; // RRULE body, e.g. "FREQ=WEEKLY;BYDAY=MO" (src/recur.ts subset)
  exdates?: string[]; // skipped occurrence dates "YYYY-MM-DD" (Seoul)
  location: string;
  notes: string;
  updatedAt: string;
  deleted: boolean;
}

export interface Task {
  id: string;
  title: string;
  color?: string; // "#RRGGBB", shown as a dot before the title
  status: Status;
  due?: string;
  priority?: Priority;
  order?: number; // position within the due day's cell
  notes: string;
  updatedAt: string;
  deleted: boolean;
}

export type Item = Event | Task;

// Key order is the on-disk order (DESIGN §4.1). Changing it reorders every line in the repo.
const EVENT_KEYS = ["id", "title", "color", "start", "end", "allDay", "recurrence", "exdates", "location", "notes", "updatedAt", "deleted"] as const;
const TASK_KEYS = ["id", "title", "color", "status", "due", "priority", "order", "notes", "updatedAt", "deleted"] as const;
const STATUSES = ["todo", "doing", "done"];
const PRIORITIES = ["high", "normal", "low"];

const SEOUL_MS = 9 * 3600_000;

/** "2026-11-15T10:00:00.000+09:00" for an instant. */
export function seoulStamp(ms: number): string {
  return new Date(ms + SEOUL_MS).toISOString().replace("Z", "+09:00");
}

/** Seoul calendar date "YYYY-MM-DD" of an instant. */
export function seoulDate(ms: number): string {
  return seoulStamp(ms).slice(0, 10);
}

/** Instant of a start/end value; a bare date means Seoul midnight. */
export function instant(value: string): number {
  return Date.parse(value.length === 10 ? `${value}T00:00:00+09:00` : value);
}

/** updatedAt for a local edit: never earlier than 1ms after the version being replaced (DESIGN §7.1 #2). */
export function nextStamp(prev: string | undefined, now: Date): string {
  const floor = prev ? Date.parse(prev) + 1 : -Infinity;
  return seoulStamp(Math.max(now.getTime(), floor));
}

function fail(msg: string): never {
  throw new Error(`invalid item: ${msg}`);
}

function str(o: Record<string, unknown>, k: string, required = false): string {
  const v = o[k];
  if (v === undefined && !required) return "";
  if (typeof v !== "string" || (required && v === "")) fail(`${k} must be a string`);
  return v;
}

function stamp(o: Record<string, unknown>): string {
  const v = str(o, "updatedAt", true);
  if (Number.isNaN(Date.parse(v))) fail(`updatedAt "${v}"`);
  return v;
}

/** Optional "#RRGGBB" (any case, stored upper); anything else holds the file. */
function color(o: Record<string, unknown>, item: Event | Task) {
  if (o.color === undefined) return;
  if (typeof o.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(o.color)) fail(`color "${String(o.color)}" on ${item.id}`);
  item.color = o.color.toUpperCase();
}

function dropUnknown(o: Record<string, unknown>, keys: readonly string[]) {
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) console.warn(`dropping unknown keys ${extra.join(", ")} on ${String(o.id)}`);
}

function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("not an object");
  return raw as Record<string, unknown>;
}

export function normalizeEvent(raw: unknown): Event {
  const o = asObject(raw);
  dropUnknown(o, EVENT_KEYS);
  const start = str(o, "start", true);
  const end = str(o, "end", true);
  if (Number.isNaN(instant(start)) || Number.isNaN(instant(end))) fail(`start/end on ${String(o.id)}`);
  const e: Event = {
    id: str(o, "id", true),
    title: str(o, "title"),
    start,
    end,
    allDay: o.allDay === true,
    location: str(o, "location"),
    notes: str(o, "notes"),
    updatedAt: stamp(o),
    deleted: o.deleted === true,
  };
  color(o, e);
  if (o.recurrence !== undefined) {
    e.recurrence = str(o, "recurrence", true);
    try {
      parseRule(e.recurrence);
    } catch (err) {
      fail(`recurrence on ${e.id}: ${(err as Error).message}`);
    }
  }
  if (o.exdates !== undefined) {
    const x = o.exdates;
    if (!Array.isArray(x) || !x.every((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))) fail(`exdates on ${e.id}`);
    if (x.length) e.exdates = [...new Set(x as string[])].sort();
  }
  return e;
}

export function normalizeTask(raw: unknown): Task {
  const o = asObject(raw);
  dropUnknown(o, TASK_KEYS);
  const status = o.status ?? "todo";
  if (!STATUSES.includes(status as string)) fail(`status "${String(status)}"`);
  const t: Task = {
    id: str(o, "id", true),
    title: str(o, "title"),
    status: status as Status,
    notes: str(o, "notes"),
    updatedAt: stamp(o),
    deleted: o.deleted === true,
  };
  color(o, t);
  if (o.due !== undefined) t.due = str(o, "due", true);
  if (o.priority !== undefined) {
    if (!PRIORITIES.includes(o.priority as string)) fail(`priority "${String(o.priority)}"`);
    t.priority = o.priority as Priority;
  }
  if (o.order !== undefined) {
    if (!Number.isInteger(o.order) || (o.order as number) < 0) fail(`order "${String(o.order)}"`);
    t.order = o.order as number;
  }
  return t;
}

function parseList<T>(text: string, norm: (raw: unknown) => T): T[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) fail("file is not an array");
  return data.map(norm);
}

/** Throws on broken JSON or an invalid item; callers hold the file instead of overwriting it (§7.2 #6). */
export const parseEvents = (text: string) => parseList(text, normalizeEvent);
export const parseTasks = (text: string) => parseList(text, normalizeTask);

/** One item as a plain object in on-disk key order, optional keys left out when absent. */
export function ordered(item: Item): Record<string, unknown> {
  const keys = "status" in item ? TASK_KEYS : EVENT_KEYS;
  const src = item as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

function serializeList(items: Item[]): string {
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(sorted.map(ordered), null, 2) + "\n";
}

export const serializeEvents = (events: Event[]) => serializeList(events);
export const serializeTasks = (tasks: Task[]) => serializeList(tasks);
