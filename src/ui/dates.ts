// Calendar days are plain "YYYY-MM-DD" strings in Seoul time; arithmetic runs on UTC dates so DST/local zone never leaks in.
import { instant, seoulDate, seoulStamp, type Event } from "../model";

export const today = () => seoulDate(Date.now());

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

/** "2026년 2월 1일 (일)": the native date input follows the Windows region format (02/01/2026), so spell it out. */
export function koDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || ymd(y, m - 1, day) !== d) return "";
  return `${y}년 ${m}월 ${day}일 (${"일월화수목금토"[weekday(d)]})`;
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

/** Overlaps the Seoul day d. A zero-length event counts as 1 ms so it still shows on its start day. */
export function onDay(e: Event, d: string): boolean {
  const s = instant(e.start);
  return s < instant(addDays(d, 1)) && Math.max(instant(e.end), s + 1) > instant(d);
}

export const byTime = (a: Event, b: Event) =>
  Number(b.allDay) - Number(a.allDay) || instant(a.start) - instant(b.start) || a.title.localeCompare(b.title);

export const timeLabel = (e: Event) => (e.allDay ? "" : seoulStamp(instant(e.start)).slice(11, 16));

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
  const s = seoulStamp(instant(e.start));
  const en = seoulStamp(instant(e.end));
  return {
    title: e.title,
    allDay: e.allDay,
    startDate: s.slice(0, 10),
    startTime: e.allDay ? "09:00" : s.slice(11, 16),
    // All-day end is exclusive on disk; the form shows the last day included.
    endDate: e.allDay ? addDays(e.end.slice(0, 10), -1) : en.slice(0, 10),
    endTime: e.allDay ? "10:00" : en.slice(11, 16),
    location: e.location,
    notes: e.notes,
  };
}

/** The edited event, or an error message for the form. */
export function fromForm(f: EventForm, base: Event): Event | string {
  const start = f.allDay ? f.startDate : `${f.startDate}T${f.startTime}:00+09:00`;
  const end = f.allDay ? addDays(f.endDate, 1) : `${f.endDate}T${f.endTime}:00+09:00`;
  if (Number.isNaN(instant(start)) || Number.isNaN(instant(end))) return "날짜와 시간을 모두 입력하세요.";
  if (f.allDay ? f.endDate < f.startDate : instant(end) < instant(start)) return "끝이 시작보다 빠릅니다.";
  return { ...base, title: f.title.trim(), allDay: f.allDay, start, end, location: f.location, notes: f.notes };
}
