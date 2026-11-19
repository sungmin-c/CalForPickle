import type { Event } from "./model";

export const EVENTS_DIR = "data/events";

/** File for an event: the month written in its start, so every PC picks the same file whatever its zone (Q17).
 *  Multi-month events stay in the start month. */
export function eventPath(e: Event): string {
  return `${EVENTS_DIR}/${e.start.slice(0, 7)}.json`;
}

export function partition(events: Event[]): Map<string, Event[]> {
  const files = new Map<string, Event[]>();
  for (const e of events) {
    const p = eventPath(e);
    files.set(p, [...(files.get(p) ?? []), e]);
  }
  return files;
}
