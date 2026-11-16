import { instant, seoulDate, type Event } from "./model";

export const EVENTS_DIR = "data/events";

/** File for an event: the Seoul month of its start (multi-month events stay in the start month). */
export function eventPath(e: Event): string {
  return `${EVENTS_DIR}/${seoulDate(instant(e.start)).slice(0, 7)}.json`;
}

export function partition(events: Event[]): Map<string, Event[]> {
  const files = new Map<string, Event[]>();
  for (const e of events) {
    const p = eventPath(e);
    files.set(p, [...(files.get(p) ?? []), e]);
  }
  return files;
}
