// RRULE subset (RFC 5545) the app can expand. Anything outside it is rejected so the file is held, never half-shown.
// ponytail: day-by-day scan from the series start, fine for a personal calendar; jump by period if rules get dense or old.
import { instant, seoulDate, seoulStamp, type Event } from "./model";

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

function untilOf(v: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(v);
  if (!m) throw new Error(`UNTIL "${v}"`);
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return instant(addDays(date, 1)) - 1; // a bare date includes that whole day
  return Date.parse(`${date}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : "+09:00"}`);
}

/** Throws on anything outside the supported subset. */
export function parseRule(text: string): Rule {
  const parts = new Map<string, string>();
  for (const p of text.replace(/^RRULE:/, "").split(";")) {
    const [k, v, extra] = p.split("=");
    if (!k || v === undefined || extra !== undefined || parts.has(k)) throw new Error(`rule part "${p}"`);
    parts.set(k, v);
  }
  const freq = parts.get("FREQ") as Freq;
  if (!ALLOWED[freq]) throw new Error(`FREQ "${String(freq)}"`);
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
  if (parts.has("UNTIL")) r.until = untilOf(parts.get("UNTIL")!);
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

/** Recurring events become one copy per occurrence overlapping [from, to) (Seoul dates); others pass through. */
export function expand(events: Event[], from: string, to: string): Event[] {
  const fromMs = instant(from);
  const out: Event[] = [];
  for (const e of events) {
    if (!e.recurrence) {
      out.push(e);
      continue;
    }
    const r = parseRule(e.recurrence);
    const s = instant(e.start);
    const first = seoulDate(s);
    const span = instant(e.end) - s;
    const days = e.allDay ? daysBetween(e.start, e.end) : 0;
    const hits = matcher(r, first);
    const skip = new Set(e.exdates);
    let n = 0;
    for (let d = first; d < to; d = addDays(d, 1)) {
      if (!hits(d)) continue;
      const ms = s + daysBetween(first, d) * DAY_MS; // Seoul has no DST
      if (r.until !== undefined && ms > r.until) break;
      if (r.count !== undefined && ++n > r.count) break;
      if (skip.has(d)) continue;
      const end = e.allDay ? instant(addDays(d, days)) : ms + span;
      if (Math.max(end, ms + 1) <= fromMs) continue;
      const stamp = (x: number) => seoulStamp(x).replace(".000", "");
      out.push(e.allDay ? { ...e, start: d, end: addDays(d, days) } : { ...e, start: stamp(ms), end: stamp(end) });
    }
  }
  return out;
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** "매주 월요일", "2주마다 화요일, 10회", "매년 1월 12일, 2030-12-31까지". */
export function describeRule(text: string, start: string): string {
  const r = parseRule(text);
  const [, m, d] = ymd(seoulDate(instant(start)));
  const unit = { DAILY: "일", WEEKLY: "주", MONTHLY: "월", YEARLY: "년" }[r.freq];
  const head = r.interval > 1 ? `${r.interval}${r.freq === "MONTHLY" ? "개월" : unit}마다` : `매${unit}`;
  const days = (r.byDay ?? (r.freq === "WEEKLY" ? [weekday(seoulDate(instant(start)))] : [])).map((i) => DOW[i]);
  const monthDays = (r.byMonthDay ?? [d]).join("·");
  const detail = {
    DAILY: days.length ? `${days.join("·")}요일` : "",
    WEEKLY: `${days.join("·")}요일`,
    MONTHLY: `${monthDays}일`,
    YEARLY: `${(r.byMonth ?? [m]).join("·")}월 ${monthDays}일`,
  }[r.freq];
  const tail = r.count ? `, ${r.count}회` : r.until !== undefined ? `, ${seoulDate(r.until)}까지` : "";
  return `${head}${detail ? ` ${detail}` : ""}${tail}`;
}
