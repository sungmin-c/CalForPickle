// RRULE subset (RFC 5545) the app can expand. Anything outside it is rejected so the file is held, never half-shown.
// ponytail: day-by-day scan over the range; with COUNT it still starts at the series start, so an old COUNT series is slow.
import { tr } from "./i18n";
import { instant, isDate, type Event } from "./model";
import { at, dateIn, dayStart, offsetMin, stampIn, ZONE, zoneOf } from "./zone";

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export interface Rule {
  freq: Freq;
  interval: number;
  byDay?: number[]; // 0 = Sunday
  byMonth?: number[];
  byMonthDay?: number[];
  count?: number;
  until?: number; // last allowed start instant (inclusive)
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const ALLOWED: Record<Freq, string[]> = {
  DAILY: ["BYDAY", "BYMONTH", "BYMONTHDAY"],
  WEEKLY: ["BYDAY", "BYMONTH"],
  MONTHLY: ["BYMONTH", "BYMONTHDAY"],
  YEARLY: ["BYMONTH", "BYMONTHDAY"],
};
const COMMON = ["FREQ", "INTERVAL", "COUNT", "UNTIL"];

const DAY_MS = 86400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY_MS);
const weekday = (d: string) => new Date(utc(d)).getUTCDay();
const ymd = (d: string) => d.split("-").map(Number) as [number, number, number];

function nums(v: string, min: number, max: number): number[] {
  return v.split(",").map((x) => {
    const n = Number(x);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`rule value "${x}"`);
    return n;
  });
}

/** UNTIL without "Z" is a wall time in the series' zone. */
function untilOf(v: string, zone: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(v);
  if (!m) throw new Error(`UNTIL "${v}"`);
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!isDate(date)) throw new Error(`UNTIL "${v}"`);
  if (!m[4]) return dayStart(addDays(date, 1), zone) - 1; // a bare date includes that whole day
  const time = `${m[4]}:${m[5]}:${m[6]}`;
  const ms = m[7] ? Date.parse(`${date}T${time}Z`) : at(date, time, zone);
  if (Number.isNaN(ms)) throw new Error(`UNTIL "${v}"`);
  return ms;
}

/** Throws on anything outside the supported subset. `zone` only matters for an UNTIL without "Z". */
export function parseRule(text: string, zone = "+09:00"): Rule {
  const parts = new Map<string, string>();
  for (const p of text.replace(/^RRULE:/, "").split(";")) {
    const [k, v, extra] = p.split("=");
    if (!k || v === undefined || extra !== undefined || parts.has(k)) throw new Error(`rule part "${p}"`);
    parts.set(k, v);
  }
  const freq = parts.get("FREQ") as Freq;
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, freq)) throw new Error(`FREQ "${String(freq)}"`);
  for (const k of parts.keys()) if (!COMMON.includes(k) && !ALLOWED[freq].includes(k)) throw new Error(`unsupported ${k}`);
  if (parts.has("COUNT") && parts.has("UNTIL")) throw new Error("COUNT with UNTIL");
  const r: Rule = { freq, interval: parts.has("INTERVAL") ? nums(parts.get("INTERVAL")!, 1, 999)[0] : 1 };
  if (parts.has("BYDAY"))
    r.byDay = parts.get("BYDAY")!.split(",").map((d) => {
      const i = DAYS.indexOf(d);
      if (i < 0) throw new Error(`BYDAY "${d}"`);
      return i;
    });
  if (parts.has("BYMONTH")) r.byMonth = nums(parts.get("BYMONTH")!, 1, 12);
  if (parts.has("BYMONTHDAY")) r.byMonthDay = nums(parts.get("BYMONTHDAY")!, 1, 31);
  if (parts.has("COUNT")) r.count = nums(parts.get("COUNT")!, 1, 100_000)[0];
  if (parts.has("UNTIL")) r.until = untilOf(parts.get("UNTIL")!, zone);
  return r;
}

/** Missing BY* parts default to the series start, as RFC 5545 does. */
function matcher(r: Rule, start: string): (d: string) => boolean {
  const [sy, sm, sd] = ymd(start);
  const byDay = r.byDay ?? (r.freq === "WEEKLY" ? [weekday(start)] : undefined);
  const byMonth = r.byMonth ?? (r.freq === "YEARLY" ? [sm] : undefined);
  const byMonthDay = r.byMonthDay ?? (r.freq === "MONTHLY" || r.freq === "YEARLY" ? [sd] : undefined);
  const weekStart = addDays(start, -((weekday(start) + 6) % 7)); // WKST=MO
  return (d) => {
    const [y, m, day] = ymd(d);
    const period = {
      DAILY: daysBetween(start, d),
      WEEKLY: Math.floor(daysBetween(weekStart, d) / 7),
      MONTHLY: (y - sy) * 12 + (m - sm),
      YEARLY: y - sy,
    }[r.freq];
    return period % r.interval === 0 && (!byDay || byDay.includes(weekday(d))) &&
      (!byMonth || byMonth.includes(m)) && (!byMonthDay || byMonthDay.includes(day));
  };
}

/** Overlaps the local days [from, to). All-day dates are the same in every zone; a zero-length event counts as 1 ms. */
export function overlaps(e: Event, from: string, to: string): boolean {
  if (e.allDay) return e.start < to && (e.end > from || e.start >= from);
  const s = instant(e.start);
  return s < dayStart(to) && Math.max(instant(e.end), s + 1) > dayStart(from);
}

/** Zone the series repeats in (Q18): its tz, else the fixed offset of start. All-day series are plain dates. */
const seriesZone = (e: Pick<Event, "start" | "allDay" | "tz">) => (e.allDay ? ZONE : zoneOf(e.start, e.tz));

/** Recurring events become one copy per occurrence overlapping the local days [from, to); others pass through.
 *  Occurrences are matched on dates in the series' zone (exdates too) and keep its offset in their stamps. */
export function expand(events: Event[], from: string, to: string): Event[] {
  const out: Event[] = [];
  for (const e of events) {
    if (!e.recurrence) {
      out.push(e);
      continue;
    }
    const zone = seriesZone(e);
    const r = parseRule(e.recurrence, zone);
    const s = instant(e.start);
    const first = e.allDay ? e.start.slice(0, 10) : dateIn(s, zone);
    const time = stampIn(s, zone).slice(11, 23);
    const span = instant(e.end) - s;
    const days = e.allDay ? daysBetween(first, e.end.slice(0, 10)) : 0; // slice: a stray timed value cannot yield NaN
    const hits = matcher(r, first);
    const skip = new Set(e.exdates);
    const stamp = (x: number) => stampIn(x, zone).replace(".000", "");
    // The series' date can run up to a day either side of the local one.
    const before = addDays(from, -2);
    const last = addDays(to, 2);
    const msOf = (d: string) => (e.allDay ? dayStart(d) : at(d, time, zone));
    let n = 0;
    // `hits` tells a date's period from the start itself, so without COUNT the days before the range can be skipped.
    const scan = r.count === undefined && before > first ? before : first;
    for (let d = scan; d < last; d = addDays(d, 1)) {
      if (!hits(d)) continue;
      if (r.until !== undefined && msOf(d) > r.until) break;
      if (r.count !== undefined && ++n > r.count) break;
      if (d < before || skip.has(d)) continue; // earlier occurrences only count toward COUNT
      const ms = msOf(d);
      const occ = e.allDay ? { ...e, start: d, end: addDays(d, days) } : { ...e, start: stamp(ms), end: stamp(ms + span) };
      if (overlaps(occ, from, to)) out.push(occ);
    }
  }
  return out;
}

/** No occurrence left from today on. ponytail: looks 10 years ahead; a rule with no UNTIL/COUNT never ends. */
export function hasEnded(e: Event, today: string): boolean {
  const r = parseRule(e.recurrence!);
  if (r.until === undefined && r.count === undefined) return false;
  return expand([e], today, addDays(today, 3650)).length === 0;
}

/** Routine list: live recurring events, running first then by title. `hasEnded` runs once per routine, not per sort comparison. */
export function routineList(events: Event[], today: string): { routines: Event[]; ended: Set<string> } {
  const ended = new Set<string>();
  const routines = events.filter((e) => e.recurrence && !e.deleted);
  for (const e of routines) if (hasEnded(e, today)) ended.add(e.id);
  routines.sort((a, b) => Number(ended.has(a.id)) - Number(ended.has(b.id)) || a.title.localeCompare(b.title, "ko"));
  return { routines, ended };
}

/** "매주 월요일", "Every 2 weeks on Tue, 10 times". A series on another zone than the PC's says which (Q13). */
export function describeRule(text: string, start: string, tz?: string): string {
  const allDay = start.length === 10;
  const zone = seriesZone({ start, allDay, tz });
  const r = parseRule(text, zone);
  const first = allDay ? start : dateIn(instant(start), zone);
  const [, m, d] = ymd(first);
  const ms = instant(start);
  const other = !allDay && offsetMin(ms, zone) !== offsetMin(ms, ZONE);
  return tr.rule({
    freq: r.freq,
    interval: r.interval,
    days: r.byDay ?? (r.freq === "WEEKLY" ? [weekday(first)] : []),
    months: r.byMonth ?? [m],
    monthDays: r.byMonthDay ?? [d],
    count: r.count,
    until: r.until === undefined ? undefined : dateIn(r.until, zone),
    zone: other ? tz ?? `UTC${zone === "Z" ? "" : zone}` : undefined,
  });
}
