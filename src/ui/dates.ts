// Calendar days are plain "YYYY-MM-DD" strings in the PC's zone; arithmetic runs on UTC dates so DST never leaks in.
import { tr } from "../i18n";
import { instant, isDate, type Event } from "../model";
import { overlaps } from "../recur";
import { at, dateIn, stampIn, ZONE } from "../zone";

export const today = () => dateIn(Date.now());

const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const ymd = (y: number, m0: number, day: number) => new Date(Date.UTC(y, m0, day)).toISOString().slice(0, 10);

export function addDays(d: string, n: number): string {
  const [y, m, day] = parts(d);
  return ymd(y, m - 1, day + n);
}

/** Same day n months away, clamped to the month's last day. */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = parts(d);
  const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return ymd(y, m - 1 + n, Math.min(day, last));
}

/** 0 = Sunday. */
export const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** "2026년 2월 1일 (일)" / "Sun, Feb 1, 2026": the native date input follows the Windows region format (02/01/2026), so spell it out. */
export function longDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || ymd(y, m - 1, day) !== d) return "";
  return tr.longDate(d);
}

export const weekDays = (d: string) => Array.from({ length: 7 }, (_, i) => addDays(d, i - weekday(d)));

/** Whole Sunday-start weeks covering the month of d. */
export function monthDays(d: string): string[] {
  const first = d.slice(0, 8) + "01";
  const last = addDays(addMonths(first, 1), -1);
  const start = addDays(first, -weekday(first));
  const count = Math.ceil((weekday(first) + Number(last.slice(8))) / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** Overlaps the local day d. A zero-length event counts as 1 ms so it still shows on its start day. */
export const onDay = (e: Event, d: string) => overlaps(e, d, addDays(d, 1));

export const byTime = (a: Event, b: Event) =>
  Number(b.allDay) - Number(a.allDay) || instant(a.start) - instant(b.start) || a.title.localeCompare(b.title);

export const timeLabel = (e: Event) => (e.allDay ? "" : stampIn(instant(e.start)).slice(11, 16));

export interface EventForm {
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  notes: string;
}

export function toForm(e: Event): EventForm {
  const s = stampIn(instant(e.start));
  const en = stampIn(instant(e.end));
  return {
    title: e.title,
    allDay: e.allDay,
    startDate: e.allDay ? e.start.slice(0, 10) : s.slice(0, 10),
    startTime: e.allDay ? "09:00" : s.slice(11, 16),
    // All-day end is exclusive on disk; the form shows the last day included.
    endDate: e.allDay ? addDays(e.end.slice(0, 10), -1) : en.slice(0, 10),
    endTime: e.allDay ? "10:00" : en.slice(11, 16),
    location: e.location,
    notes: e.notes,
  };
}

/** The edited event, or an error message for the form. Changed times are written in the PC's zone and tagged with it (tz);
 *  unchanged ones keep their stored text and zone, so editing a title never moves a series to another zone (Q19). */
export function fromForm(f: EventForm, base: Event): Event | string {
  const local = (d: string, t: string) => stampIn(at(d, t)).replace(".000", "");
  const timed = !f.allDay && isDate(f.startDate) && isDate(f.endDate) && !!f.startTime && !!f.endTime;
  const start = f.allDay ? f.startDate : timed ? local(f.startDate, f.startTime) : "";
  const end = f.allDay ? (f.endDate ? addDays(f.endDate, 1) : "") : timed ? local(f.endDate, f.endTime) : "";
  if (!start || !end || Number.isNaN(instant(start)) || Number.isNaN(instant(end))) return tr.missingDateTime;
  if (f.allDay ? f.endDate < f.startDate : instant(end) < instant(start)) return tr.endBeforeStart;
  const out: Event = { ...base, title: f.title.trim(), allDay: f.allDay, start, end, location: f.location, notes: f.notes };
  delete out.tz;
  if (f.allDay) return out;
  const was = toForm(base);
  if (!base.allDay && was.startDate === f.startDate && was.startTime === f.startTime && was.endDate === f.endDate && was.endTime === f.endTime)
    return { ...out, start: base.start, end: base.end, ...(base.tz ? { tz: base.tz } : {}) };
  return { ...out, tz: ZONE };
}
