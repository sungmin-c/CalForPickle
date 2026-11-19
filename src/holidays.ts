// Korean public holidays as "YYYY-MM-DD" -> name. Fixed days and the lunar ones (Intl's Korean "dangi" calendar; the Chinese
// one is a day off in some years, e.g. 설날 2028) are computed; substitute holidays follow the current rules.
// Government-declared extra days (elections, temporary holidays) can't be computed: add them to EXTRA.
import { addDays, weekday } from "./ui/dates";

const EXTRA: Record<string, string> = {
  "2026-06-03": "지방선거일",
  "2025-06-03": "대통령선거일",
  "2025-01-27": "임시공휴일",
  "2024-04-10": "국회의원선거일",
  "2024-10-01": "국군의날",
};

const FIXED: Record<string, string> = {
  "01-01": "신정", "03-01": "삼일절", "05-05": "어린이날", "06-06": "현충일",
  "08-15": "광복절", "10-03": "개천절", "10-09": "한글날", "12-25": "성탄절",
};
// Fixed holidays that only exist from the given year (2027 월력요항: 노동절·제헌절 apply from 2026).
const FIXED_FROM: Record<string, [number, string]> = { "05-01": [2026, "노동절"], "07-17": [2026, "제헌절"] };
// Holidays that earn a substitute day. 설날/추석 blocks only for a Sunday, the rest for Saturday or Sunday; all of them when
// another holiday falls on the same day.
const SUBSTITUTED = new Set(["삼일절", "어린이날", "광복절", "개천절", "한글날", "성탄절", "부처님오신날", "설날", "추석", "노동절", "제헌절"]);

const lunar = new Intl.DateTimeFormat("en-u-ca-dangi", { month: "numeric", day: "numeric", timeZone: "UTC" });
const cache = new Map<number, Map<string, string>>();

function build(year: number): Map<string, string> {
  const days = new Map<string, string[]>(); // a day can hold two holidays, e.g. 2025-05-05 어린이날 and 부처님오신날
  const add = (d: string, name: string) => days.set(d, [...(days.get(d) ?? []), name]);
  for (const [md, name] of Object.entries(FIXED)) add(`${year}-${md}`, name);
  for (const [md, [from, name]] of Object.entries(FIXED_FROM)) if (year >= from) add(`${year}-${md}`, name);
  for (let d = `${year}-01-01`; d.startsWith(String(year)); d = addDays(d, 1)) {
    const p = lunar.formatToParts(new Date(`${d}T00:00:00Z`));
    const m = p.find((x) => x.type === "month")!.value, day = p.find((x) => x.type === "day")!.value;
    if (m === "4" && day === "8") add(d, "부처님오신날");
    if ((m === "1" && day === "1") || (m === "8" && day === "15")) {
      const name = m === "1" ? "설날" : "추석";
      for (const x of [addDays(d, -1), d, addDays(d, 1)]) add(x, x === d ? name : `${name} 연휴`);
    }
  }
  for (const [d, name] of Object.entries(EXTRA)) if (d.startsWith(String(year))) add(d, name);

  const base = new Map([...days].map(([d, names]) => [d, names.join("·")]));
  const free = (d: string) => weekday(d) !== 0 && weekday(d) !== 6 && !base.has(d);
  const substitute = (after: string, names: string[]) => {
    let d = addDays(after, 1);
    while (!free(d)) d = addDays(d, 1);
    base.set(d, `대체공휴일(${names.join("·")})`);
  };
  for (const [d, names] of [...days].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const eligible = names.map((n) => n.replace(/ 연휴$/, "")).filter((n) => SUBSTITUTED.has(n));
    const w = weekday(d);
    if (w === 0 || w === 6) {
      // ponytail: two holidays sharing a weekend day only count the weekend rule; no such day yet in the calendar
      const lost = eligible.filter((n) => w === 0 || (n !== "설날" && n !== "추석"));
      lost.forEach((n) => substitute(d, [n]));
    } else {
      // A weekday gives one day off however many holidays share it (2017-10-03 개천절 in the 추석 block: one day, 10-06).
      for (let i = 0; i < Math.min(names.length - 1, eligible.length); i++) substitute(d, eligible);
    }
  }
  return base;
}

export function holidayName(d: string): string | undefined {
  const y = Number(d.slice(0, 4));
  if (!cache.has(y)) cache.set(y, build(y));
  return cache.get(y)!.get(d);
}

// US federal holidays (English, session 23): 5 fixed days with observed days, 6 weekday rules.
const US_FIXED: [string, string][] = [
  ["01-01", "New Year's Day"], ["06-19", "Juneteenth"], ["07-04", "Independence Day"], ["11-11", "Veterans Day"], ["12-25", "Christmas Day"],
];
// [month, weekday (0 = Sunday), nth (-1 = last)]
const US_RULES: [number, number, number, string][] = [
  [1, 1, 3, "Martin Luther King Jr. Day"], [2, 1, 3, "Presidents' Day"], [5, 1, -1, "Memorial Day"],
  [9, 1, 1, "Labor Day"], [10, 1, 2, "Columbus Day"], [11, 4, 4, "Thanksgiving"],
];
const usCache = new Map<number, Map<string, string>>();

function buildUs(year: number): Map<string, string> {
  const m = new Map<string, string>();
  // A Saturday holiday is observed the Friday before, a Sunday one the Monday after. Next year's New Year's Day can land on Dec 31.
  for (const y of [year, year + 1])
    for (const [md, name] of US_FIXED) {
      const d = `${y}-${md}`;
      const w = weekday(d);
      if (y === year) m.set(d, name);
      if (w === 6 || w === 0) m.set(addDays(d, w === 6 ? -1 : 1), `${name} (observed)`);
    }
  for (const [month, wd, nth, name] of US_RULES) {
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    let d = addDays(first, (wd - weekday(first) + 7) % 7);
    if (nth > 0) d = addDays(d, 7 * (nth - 1));
    else while (addDays(d, 7).slice(5, 7) === first.slice(5, 7)) d = addDays(d, 7);
    m.set(d, name);
  }
  return m;
}

export function usHolidayName(d: string): string | undefined {
  const y = Number(d.slice(0, 4));
  if (!usCache.has(y)) usCache.set(y, buildUs(y));
  return usCache.get(y)!.get(d);
}
