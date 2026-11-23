// The routine dialog's repeat section as plain data: RRULE text <-> form values. The form draws only the shapes below;
// any other valid rule is "advanced": read-only, and saved back as its original text unless the user replaces it (nextRule).
import { tr } from "../i18n";
import { instant, isDate, type Event } from "../model";
import { expand, parseRule, type Rule } from "../recur";
import { dateIn, zoneOf } from "../zone";
import { addDays, weekday } from "./dates";

export type RepeatFreq = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RepeatForm {
  freq: RepeatFreq;
  interval: number;
  /** Weekly weekdays, 0 = Sunday. undefined: the start date's weekday, following it when the start moves (D3). */
  days?: number[];
  mode: "date" | "nth" | "last"; // monthly: day of month / Nth weekday / last day
  monthDay?: number; // undefined: the start date's day
  nth?: [number, number]; // [ordinal 1..5 or -1, weekday]; undefined: the start date's
  end: "never" | "count" | "until";
  count: number;
  until: string; // "YYYY-MM-DD"
}

export const defaultRepeat = (): RepeatForm => ({ freq: "NONE", interval: 1, mode: "date", end: "never", count: 10, until: "" });

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export const startDay = (start: string) => Number(start.slice(8, 10));
export const startNth = (start: string): [number, number] => [Math.ceil(startDay(start) / 7), weekday(start)];

/** The date the series repeats from, read in the series' own zone (what recur.ts expands on). */
export const seriesDate = (e: Pick<Event, "start" | "allDay" | "tz">) =>
  e.allDay ? e.start.slice(0, 10) : dateIn(instant(e.start), zoneOf(e.start, e.tz));

/** Form values for a rule, or null when the rule is outside what the form can draw. `start` is the series date. */
export function ruleToForm(text: string, start: string): RepeatForm | null {
  let r: Rule;
  try {
    r = parseRule(text);
  } catch {
    return null;
  }
  const f: RepeatForm = { ...defaultRepeat(), freq: r.freq, interval: r.interval };
  if (r.count !== undefined) Object.assign(f, { end: "count", count: r.count });
  if (r.until !== undefined) {
    const m = /UNTIL=(\d{4})(\d{2})(\d{2})(?:;|$)/.exec(text); // a date with a time of day is advanced
    if (!m) return null;
    Object.assign(f, { end: "until", until: `${m[1]}-${m[2]}-${m[3]}` });
  }
  const only = (...ok: string[]) => (["byDay", "byNth", "byMonth", "byMonthDay"] as const).every((k) => r[k] === undefined || ok.includes(k));
  const [sm, sd] = [Number(start.slice(5, 7)), startDay(start)];
  if (r.freq === "DAILY") return only() ? f : null;
  if (r.freq === "WEEKLY") {
    if (!only("byDay")) return null;
    const days = [...new Set(r.byDay)].sort();
    if (days.length && !(days.length === 1 && days[0] === weekday(start))) f.days = days;
    return f;
  }
  if (r.freq === "YEARLY")
    return only("byMonth", "byMonthDay") && (!r.byMonth || (r.byMonth.length === 1 && r.byMonth[0] === sm)) &&
      (!r.byMonthDay || (r.byMonthDay.length === 1 && r.byMonthDay[0] === sd)) ? f : null;
  if (!only("byNth", "byMonthDay") || (r.byNth && r.byMonthDay)) return null;
  if (r.byNth) {
    const [k, w] = r.byNth[0];
    if (r.byNth.length !== 1 || (k < 0 && k !== -1)) return null;
    f.mode = "nth";
    if (`${k},${w}` !== startNth(start).join()) f.nth = [k, w];
  } else if (r.byMonthDay) {
    const v = r.byMonthDay[0];
    if (r.byMonthDay.length !== 1 || (v < 0 && v !== -1)) return null;
    if (v === -1) f.mode = "last";
    else if (v !== sd) f.monthDay = v;
  }
  return f;
}

/** RRULE text for the form, with start-following values read from `start`. "" for no repeat. */
export function formToRule(f: RepeatForm, start: string): string {
  if (f.freq === "NONE") return "";
  const p = [`FREQ=${f.freq}`];
  if (f.interval > 1) p.push(`INTERVAL=${f.interval}`);
  if (f.freq === "WEEKLY")
    p.push(`BYDAY=${[...(f.days ?? [weekday(start)])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]).join(",")}`);
  if (f.freq === "MONTHLY") {
    if (f.mode === "date") p.push(`BYMONTHDAY=${f.monthDay ?? startDay(start)}`);
    else if (f.mode === "last") p.push("BYMONTHDAY=-1");
    else {
      const [k, w] = f.nth ?? startNth(start);
      p.push(`BYDAY=${k}${DAYS[w]}`);
    }
  }
  if (f.end === "count") p.push(`COUNT=${f.count}`);
  if (f.end === "until") p.push(`UNTIL=${f.until.replace(/-/g, "")}`);
  return p.join(";");
}

/** The rule text to store. Anything the user did not change keeps its original characters (D4): an advanced rule
 *  (rep null), or a form that still says what the original did. `start` / `origStart`: series date now / when opened. */
export function nextRule(rep: RepeatForm | null, orig: string | undefined, origStart: string, start: string): string | undefined {
  if (!rep) return orig;
  if (rep.freq === "NONE") return undefined;
  const text = formToRule(rep, start);
  const was = orig && ruleToForm(orig, origStart);
  return was && formToRule(was, origStart) === text ? orig : text;
}

/** Message for the first problem in the form, or "". Hidden controls (not used by the frequency or end) are not checked. */
export function repeatError(f: RepeatForm, start: string): string {
  if (f.freq === "NONE") return "";
  if (!Number.isInteger(f.interval) || f.interval < 1 || f.interval > 999) return tr.badInterval;
  if (f.freq === "WEEKLY" && f.days?.length === 0) return tr.noWeekday;
  if (f.end === "count" && (!Number.isInteger(f.count) || f.count < 1 || f.count > 100_000)) return tr.badCount;
  if (f.end === "until") {
    if (!isDate(f.until)) return tr.noUntil;
    if (f.until < start) return tr.untilBeforeStart;
  }
  return "";
}

/** True when the chosen day does not exist in every month (29-31), or a yearly Feb 29: those occurrences are skipped (D6). */
export const skipsMonths = (f: RepeatForm, start: string): boolean =>
  (f.freq === "MONTHLY" && f.mode === "date" && (f.monthDay ?? startDay(start)) >= 29) || (f.freq === "YEARLY" && start.slice(5, 10) === "02-29");

/** "Delete this and later": the routine ending the day before `day` (a date in the series' zone), COUNT swapped for the
 *  UNTIL since the two can't share a rule. null when no occurrence is left before `day`: the caller deletes the whole routine. */
export function deleteFrom(e: Event, day: string): Event | null {
  const first = seriesDate(e);
  if (!expand([e], addDays(first, -2), day).some((o) => o.start.slice(0, 10) < day)) return null;
  const keep = e.recurrence!.split(";").filter((p) => !/^(COUNT|UNTIL)=/.test(p));
  return { ...e, recurrence: [...keep, `UNTIL=${addDays(day, -1).replace(/-/g, "")}`].join(";") };
}
