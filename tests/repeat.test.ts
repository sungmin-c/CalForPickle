import { describe, expect, it } from "vitest";
import { AGENT_GUIDE } from "../src/agentGuide";
import { expand, parseRule } from "../src/recur";
import { addDays } from "../src/ui/dates";
import { defaultRepeat, deleteFrom, formToRule, nextRule, repeatError, ruleToForm, skipsMonths } from "../src/ui/repeat";
import type { Event } from "../src/model";
import { ev } from "./fixtures";

const dates = (start: string, recurrence: string) =>
  expand([ev({ id: "r", start, end: addDays(start, 1), allDay: true, recurrence })], "2026-01-01", "2029-01-01").map((e) => e.start);

// 2026-11-16 is a Monday, the 3rd Monday of the month.
const MON = "2026-11-16";

describe("rule -> form -> rule keeps the meaning", () => {
  const cases: [string, string, string][] = [
    ["every day", "FREQ=DAILY", MON],
    ["every 3 days", "FREQ=DAILY;INTERVAL=3", MON],
    ["weekly, implicit weekday", "FREQ=WEEKLY", MON],
    ["weekly Monday = start weekday", "FREQ=WEEKLY;BYDAY=MO", MON],
    ["weekly Tuesday, start is Monday", "FREQ=WEEKLY;BYDAY=TU", MON],
    ["weekdays", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", MON],
    ["every 2 weeks Sun+Sat", "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,SA", MON],
    ["monthly, implicit day", "FREQ=MONTHLY", "2026-11-15"],
    ["monthly 15th", "FREQ=MONTHLY;BYMONTHDAY=15", "2026-11-15"],
    ["monthly 20th, start is 15th", "FREQ=MONTHLY;BYMONTHDAY=20", "2026-11-15"],
    ["monthly 31st (skips short months)", "FREQ=MONTHLY;BYMONTHDAY=31", "2026-01-31"],
    ["quarterly", "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1", "2026-01-01"],
    ["month end", "FREQ=MONTHLY;BYMONTHDAY=-1", "2026-01-31"],
    ["3rd Monday = start", "FREQ=MONTHLY;BYDAY=3MO", MON],
    ["2nd Monday, start is 3rd", "FREQ=MONTHLY;BYDAY=2MO", MON],
    ["last Friday", "FREQ=MONTHLY;BYDAY=-1FR", "2026-11-27"],
    ["5th Monday (some months skipped)", "FREQ=MONTHLY;BYDAY=5MO", "2026-11-30"],
    ["yearly", "FREQ=YEARLY", "2026-11-15"],
    ["yearly Feb 29", "FREQ=YEARLY", "2028-02-29"],
    ["yearly every 2, explicit month/day = start", "FREQ=YEARLY;INTERVAL=2;BYMONTH=11;BYMONTHDAY=15", "2026-11-15"],
    ["count", "FREQ=WEEKLY;BYDAY=MO;COUNT=5", MON],
    ["until (bare date)", "FREQ=DAILY;UNTIL=20260301", "2026-01-01"],
    ["RRULE: prefix", "RRULE:FREQ=WEEKLY;BYDAY=MO", MON],
  ];
  for (const [name, text, start] of cases)
    it(name, () => {
      const form = ruleToForm(text, start);
      expect(form).not.toBeNull();
      expect(dates(start, formToRule(form!, start))).toEqual(dates(start, text));
    });

  it("canonical text", () => {
    expect(formToRule({ ...defaultRepeat(), freq: "DAILY" }, MON)).toBe("FREQ=DAILY");
    expect(formToRule({ ...defaultRepeat(), freq: "DAILY", interval: 3, end: "count", count: 5 }, MON)).toBe("FREQ=DAILY;INTERVAL=3;COUNT=5");
    expect(formToRule({ ...defaultRepeat(), freq: "WEEKLY", days: [5, 1, 3] }, MON)).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(formToRule({ ...defaultRepeat(), freq: "WEEKLY" }, MON)).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(formToRule({ ...defaultRepeat(), freq: "MONTHLY" }, "2026-11-15")).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
    expect(formToRule({ ...defaultRepeat(), freq: "MONTHLY", mode: "last" }, MON)).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
    expect(formToRule({ ...defaultRepeat(), freq: "MONTHLY", mode: "nth" }, MON)).toBe("FREQ=MONTHLY;BYDAY=3MO");
    expect(formToRule({ ...defaultRepeat(), freq: "MONTHLY", mode: "nth", nth: [-1, 5] }, MON)).toBe("FREQ=MONTHLY;BYDAY=-1FR");
    expect(formToRule({ ...defaultRepeat(), freq: "MONTHLY", interval: 3 }, "2026-01-01")).toBe("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1");
    expect(formToRule({ ...defaultRepeat(), freq: "YEARLY", end: "until", until: "2030-12-31" }, MON)).toBe("FREQ=YEARLY;UNTIL=20301231");
    expect(formToRule({ ...defaultRepeat(), freq: "NONE" }, MON)).toBe("");
  });
});

describe("the form follows the start date when its value came from it (D3)", () => {
  it("single weekday that is the start weekday follows; others stay", () => {
    expect(ruleToForm("FREQ=WEEKLY;BYDAY=MO", MON)!.days).toBeUndefined();
    expect(formToRule(ruleToForm("FREQ=WEEKLY;BYDAY=MO", MON)!, "2026-11-18")).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(ruleToForm("FREQ=WEEKLY;BYDAY=TU", MON)!.days).toEqual([2]);
    expect(formToRule(ruleToForm("FREQ=WEEKLY;BYDAY=TU", MON)!, "2026-11-18")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(formToRule(ruleToForm("FREQ=WEEKLY;BYDAY=MO,WE", MON)!, "2026-11-19")).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
  });
  it("monthly date and Nth weekday", () => {
    const d = ruleToForm("FREQ=MONTHLY;BYMONTHDAY=15", "2026-11-15")!;
    expect(formToRule(d, "2026-11-20")).toBe("FREQ=MONTHLY;BYMONTHDAY=20");
    const fixed = ruleToForm("FREQ=MONTHLY;BYMONTHDAY=1", "2026-11-15")!;
    expect(formToRule(fixed, "2026-11-20")).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    const n = ruleToForm("FREQ=MONTHLY;BYDAY=3MO", MON)!;
    expect(formToRule(n, "2026-11-12")).toBe("FREQ=MONTHLY;BYDAY=2TH");
    expect(formToRule(ruleToForm("FREQ=MONTHLY;BYDAY=-1FR", "2026-11-27")!, "2026-11-12")).toBe("FREQ=MONTHLY;BYDAY=-1FR");
    expect(formToRule(ruleToForm("FREQ=MONTHLY;BYMONTHDAY=-1", "2026-01-31")!, "2026-11-12")).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
  });
});

describe("rules the form cannot draw stay read-only (D4)", () => {
  const advanced = [
    "FREQ=MONTHLY;BYMONTHDAY=1,15",
    "FREQ=MONTHLY;BYMONTHDAY=-2",
    "FREQ=MONTHLY;BYDAY=-2FR",
    "FREQ=MONTHLY;BYDAY=FR",
    "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13",
    "FREQ=MONTHLY;BYDAY=1MO,3MO",
    "FREQ=MONTHLY;BYMONTH=1,7;BYMONTHDAY=1",
    "FREQ=DAILY;BYDAY=MO,WE",
    "FREQ=WEEKLY;BYDAY=MO;BYMONTH=11",
    "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1",
    "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1",
    "FREQ=DAILY;UNTIL=20260301T000000Z",
    "FREQ=HOURLY",
    "FREQ=DAILY;COUNT=2;UNTIL=20260301",
    "",
  ];
  for (const t of advanced) it(t || "(unparsable)", () => expect(ruleToForm(t, "2026-11-15")).toBeNull());
});

describe("what gets saved (nextRule)", () => {
  it("untouched form keeps the original text character for character", () => {
    for (const t of ["RRULE:FREQ=WEEKLY;BYDAY=MO", "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO", "FREQ=DAILY;INTERVAL=1"]) {
      const start = MON;
      expect(nextRule(ruleToForm(t, start), t, start, start)).toBe(t);
    }
  });
  it("advanced rule, section untouched (null): original text", () => {
    const t = "FREQ=MONTHLY;BYMONTHDAY=1,15";
    expect(nextRule(null, t, "2026-11-01", "2026-12-01")).toBe(t);
  });
  it("edited, then edited back: original text", () => {
    const t = "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO";
    const f = { ...ruleToForm(t, MON)!, interval: 1 };
    expect(nextRule(f, t, MON, MON)).toBe(t);
  });
  it("edited: canonical text", () => {
    const t = "FREQ=WEEKLY;BYDAY=MO";
    expect(nextRule({ ...ruleToForm(t, MON)!, interval: 2 }, t, MON, MON)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
  });
  it("start moved under a following value: rewritten; under a pinned value: original", () => {
    expect(nextRule(ruleToForm("FREQ=WEEKLY;BYDAY=MO", MON), "FREQ=WEEKLY;BYDAY=MO", MON, "2026-11-18")).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(nextRule(ruleToForm("FREQ=WEEKLY;BYDAY=TU", MON), "FREQ=WEEKLY;BYDAY=TU", MON, "2026-11-18")).toBe("FREQ=WEEKLY;BYDAY=TU");
  });
  it("new routine and 'no repeat'", () => {
    expect(nextRule({ ...defaultRepeat(), freq: "NONE" }, undefined, MON, MON)).toBeUndefined();
    expect(nextRule({ ...defaultRepeat(), freq: "DAILY" }, undefined, MON, MON)).toBe("FREQ=DAILY");
    expect(nextRule({ ...defaultRepeat(), freq: "NONE" }, "FREQ=DAILY", MON, MON)).toBeUndefined();
  });
  it("replacing an advanced rule writes the form's rule", () => {
    expect(nextRule({ ...defaultRepeat(), freq: "DAILY" }, "FREQ=MONTHLY;BYMONTHDAY=1,15", "2026-11-01", "2026-11-01")).toBe("FREQ=DAILY");
  });
});

describe("form errors", () => {
  const f = (o: object) => ({ ...defaultRepeat(), freq: "WEEKLY" as const, ...o });
  it("accepts a sane form and ignores values of a hidden control", () => {
    expect(repeatError(f({}), MON)).toBe("");
    expect(repeatError({ ...defaultRepeat(), freq: "NONE", interval: NaN }, MON)).toBe("");
    expect(repeatError(f({ end: "never", count: 0, until: "" }), MON)).toBe("");
  });
  it("no weekday, bad interval, bad count, missing or early until", () => {
    expect(repeatError(f({ days: [] }), MON)).not.toBe("");
    expect(repeatError(f({ interval: 0 }), MON)).not.toBe("");
    expect(repeatError(f({ interval: 1000 }), MON)).not.toBe("");
    expect(repeatError(f({ interval: NaN }), MON)).not.toBe("");
    expect(repeatError(f({ end: "count", count: 0 }), MON)).not.toBe("");
    expect(repeatError(f({ end: "count", count: 100001 }), MON)).not.toBe("");
    expect(repeatError(f({ end: "until", until: "" }), MON)).not.toBe("");
    expect(repeatError(f({ end: "until", until: "2026-11-15" }), MON)).not.toBe("");
    expect(repeatError(f({ end: "until", until: MON }), MON)).toBe("");
  });
});

describe("skip notice for days that some months lack (D6)", () => {
  it("monthly 29-31 and Feb 29 yearly only", () => {
    const m = { ...defaultRepeat(), freq: "MONTHLY" as const };
    expect(skipsMonths(m, "2026-11-28")).toBe(false);
    expect(skipsMonths(m, "2026-11-29")).toBe(true);
    expect(skipsMonths(m, "2026-01-31")).toBe(true);
    expect(skipsMonths({ ...m, monthDay: 15 }, "2026-01-31")).toBe(false);
    expect(skipsMonths({ ...m, monthDay: 30 }, "2026-01-01")).toBe(true);
    expect(skipsMonths({ ...m, mode: "last" }, "2026-01-31")).toBe(false);
    expect(skipsMonths({ ...m, mode: "nth" }, "2026-01-31")).toBe(false);
    const y = { ...defaultRepeat(), freq: "YEARLY" as const };
    expect(skipsMonths(y, "2028-02-29")).toBe(true);
    expect(skipsMonths(y, "2026-01-31")).toBe(false);
    expect(skipsMonths({ ...defaultRepeat(), freq: "WEEKLY" }, "2026-01-31")).toBe(false);
  });
});

describe("delete this and later (deleteFrom)", () => {
  const routine = (recurrence: string, o: Partial<Event> = {}) =>
    ev({ id: "r", start: MON, end: addDays(MON, 1), allDay: true, recurrence, ...o });
  const shown = (e: Event) => expand([e], "2026-01-01", "2029-01-01").map((x) => x.start);
  const cut = (e: Event, day: string) => deleteFrom(e, day) as Event;

  it("open-ended rule: UNTIL = the day before, earlier occurrences stay", () => {
    const r = cut(routine("FREQ=WEEKLY;BYDAY=MO"), "2026-11-30");
    expect(r.recurrence).toBe("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261129");
    expect(shown(r)).toEqual(["2026-11-16", "2026-11-23"]);
  });
  it("COUNT is dropped for UNTIL, same occurrences before the day", () => {
    const orig = routine("FREQ=WEEKLY;BYDAY=MO;COUNT=5");
    const r = cut(orig, "2026-11-30");
    expect(r.recurrence).toBe("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261129");
    expect(shown(r)).toEqual(shown(orig).slice(0, 2));
  });
  it("COUNT with a skipped date: the skipped one stays skipped", () => {
    const r = cut(routine("FREQ=WEEKLY;BYDAY=MO;COUNT=5", { exdates: ["2026-11-23"] }), "2026-12-07");
    expect(shown(r)).toEqual(["2026-11-16", "2026-11-30"]);
    expect(r.exdates).toEqual(["2026-11-23"]);
  });
  it("an existing UNTIL (with or without time) is replaced, RRULE: prefix kept", () => {
    expect(cut(routine("FREQ=DAILY;UNTIL=20261231"), "2026-11-20").recurrence).toBe("FREQ=DAILY;UNTIL=20261119");
    expect(cut(routine("RRULE:FREQ=DAILY;UNTIL=20261231T235959Z"), "2026-11-20").recurrence).toBe("RRULE:FREQ=DAILY;UNTIL=20261119");
  });
  it("timed series: the day is read in the series' own zone", () => {
    const e = ev({ id: "t", recurrence: "FREQ=DAILY", start: "2026-11-16T14:00:00+09:00", end: "2026-11-16T15:00:00+09:00" });
    const r = cut(e, "2026-11-18");
    expect(r.recurrence).toBe("FREQ=DAILY;UNTIL=20261117");
    expect(shown(r)).toEqual(["2026-11-16T14:00:00+09:00", "2026-11-17T14:00:00+09:00"]);
  });
  it("no occurrence before the day: null (delete the whole routine)", () => {
    expect(deleteFrom(routine("FREQ=WEEKLY;BYDAY=MO"), MON)).toBeNull();
    expect(deleteFrom(routine("FREQ=WEEKLY;COUNT=3"), MON)).toBeNull();
  });
  it("first occurrence is not the start date (BYDAY elsewhere): null", () => {
    // 2026-11-18 is a Wednesday; the first Monday is 11-23.
    expect(deleteFrom(routine("FREQ=WEEKLY;BYDAY=MO", { start: "2026-11-18", end: "2026-11-19" }), "2026-11-23")).toBeNull();
  });
  it("everything earlier was skipped: null", () => {
    expect(deleteFrom(routine("FREQ=WEEKLY;BYDAY=MO", { exdates: ["2026-11-16", "2026-11-23"] }), "2026-11-30")).toBeNull();
  });
  it("the result is still a rule the form draws, ending on a date", () => {
    const r = cut(routine("FREQ=WEEKLY;BYDAY=MO;COUNT=5"), "2026-11-30");
    expect(ruleToForm(r.recurrence!, MON)).toMatchObject({ end: "until", until: "2026-11-29" });
  });
});

describe("AGENT_GUIDE rule examples match the engine and the form", () => {
  const drawn = ["FREQ=DAILY;INTERVAL=2", "FREQ=WEEKLY;BYDAY=MO,WE", "FREQ=MONTHLY;BYMONTHDAY=15", "FREQ=MONTHLY;BYMONTHDAY=-1", "FREQ=MONTHLY;BYDAY=2MO", "FREQ=MONTHLY;BYDAY=-1FR", "FREQ=YEARLY", "FREQ=DAILY;COUNT=5", "FREQ=DAILY;UNTIL=20261231"];
  const notDrawn = ["FREQ=WEEKLY;BYMONTH=3", "FREQ=MONTHLY;BYMONTHDAY=1,15", "FREQ=MONTHLY;BYDAY=1MO,3MO", "FREQ=MONTHLY;BYMONTHDAY=-2", "FREQ=DAILY;UNTIL=20261231T235959Z", "FREQ=YEARLY;BYMONTH=3"];
  it("documents the new syntax and the read-only warning", () => {
    for (const w of ["BYMONTHDAY=-1", "BYDAY=2MO", "BYDAY=-1FR", "UI가 못 그리는 규칙"]) expect(AGENT_GUIDE).toContain(w);
  });
  it("drawn ones draw, the others parse but stay read-only", () => {
    for (const t of drawn) expect(ruleToForm(t, "2026-11-15"), t).not.toBeNull();
    for (const t of notDrawn) {
      expect(() => parseRule(t), t).not.toThrow();
      expect(ruleToForm(t, "2026-11-15"), t).toBeNull();
    }
  });
  it("no longer says Nth weekday is unsupported", () => {
    expect(AGENT_GUIDE).not.toContain("몇째 주");
  });
});
