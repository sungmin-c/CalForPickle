import { instant, seoulDate, seoulStamp, type Event, type Task } from "./model";
import { expand } from "./recur";

export const UPCOMING_PATH = "upcoming.json";
const DAYS = 14;

export interface Upcoming {
  generatedAt: string;
  from: string;
  to: string;
  events: Pick<Event, "id" | "title" | "start" | "end" | "allDay" | "location">[];
  tasks: Pick<Task, "id" | "title" | "status" | "due" | "priority">[];
}

/** Agent-facing digest: events (recurring ones expanded) overlapping [today, today+14d) and every open task. Notes left out to save tokens. */
export function generateUpcoming(events: Event[], tasks: Task[], now: Date): Upcoming {
  const from = seoulDate(now.getTime());
  const fromMs = instant(from);
  const toMs = fromMs + DAYS * 86400_000;
  const startOf = (e: Event) => instant(e.start);
  const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const byId = (a: { id: string }, b: { id: string }) => byKey(a.id, b.id);

  // A recurring event shows once per occurrence, each under the event's own id.
  const evs = expand(events.filter((e) => !e.deleted), from, seoulDate(toMs))
    // max(end, start+1ms) keeps zero-length events visible on their own instant.
    .filter((e) => !e.deleted && startOf(e) < toMs && Math.max(instant(e.end), startOf(e) + 1) > fromMs)
    .sort((a, b) => startOf(a) - startOf(b) || byId(a, b))
    .map(({ id, title, start, end, allDay, location }) => ({ id, title, start, end, allDay, location }));

  const tks = tasks
    .filter((t) => !t.deleted && t.status !== "done")
    // "~" sorts after digits by code point, putting undated tasks last. (localeCompare would not.)
    .sort((a, b) => byKey(a.due ?? "~", b.due ?? "~") || byId(a, b))
    .map(({ id, title, status, due, priority }) => ({ id, title, status, due, priority }));

  return { generatedAt: seoulStamp(now.getTime()), from, to: seoulDate(toMs), events: evs, tasks: tks };
}

export function serializeUpcoming(u: Upcoming): string {
  // JSON.stringify skips undefined, so tasks without due/priority omit the key.
  return JSON.stringify(u, null, 2) + "\n";
}
