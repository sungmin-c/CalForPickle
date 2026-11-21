import { describe, expect, it } from "vitest";
import { describeRule, expand, hasEnded, parseRule, routineList } from "../src/recur";
import { addDays } from "../src/ui/dates";
import { ev } from "./fixtures";

const allDay = (start: string, recurrence: string, exdates?: string[]) =>
  ev({ id: "r", start, end: addDays(start, 1), allDay: true, recurrence, exdates });
const starts = (es: { start: string }[]) => es.map((e) => e.start);

describe("recurrence expansion", () => {
  it("weekly without end: every Monday in range, one-day all-day each", () => {
    const out = expand([allDay("2025-09-29", "FREQ=WEEKLY;BYDAY=MO")], "2026-11-01", "2026-12-01");
    expect(starts(out)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(out[0]).toMatchObject({ id: "r", end: "2026-11-03", allDay: true });
  });

  it("COUNT counts excluded dates too (RFC 5545), exdates are removed", () => {
    const out = expand([allDay("2025-09-27", "FREQ=WEEKLY;BYDAY=SA;COUNT=10", ["2025-10-04"])], "2025-01-01", "2027-01-01");
    expect(out).toHaveLength(9);
    expect(starts(out)).not.toContain("2025-10-04");
    expect(out[out.length - 1].start).toBe("2025-11-29");
  });

  it("UNTIL date is inclusive", () => {
    const out = expand([allDay("2025-09-29", "FREQ=WEEKLY;BYDAY=MO;UNTIL=20251215")], "2025-12-01", "2026-01-01");
    expect(starts(out)).toEqual(["2025-12-01", "2025-12-08", "2025-12-15"]);
  });

  it("monthly on the 31st skips shorter months", () => {
    const out = expand([allDay("2026-01-31", "FREQ=MONTHLY;BYMONTHDAY=31")], "2026-01-01", "2026-06-01");
    expect(starts(out)).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("yearly by month and day; defaults come from start when BY* is absent", () => {
    expect(starts(expand([allDay("2026-01-12", "FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=12")], "2026-01-01", "2028-12-31")))
      .toEqual(["2026-01-12", "2027-01-12", "2028-01-12"]);
    expect(starts(expand([allDay("2026-02-01", "FREQ=MONTHLY")], "2026-11-15", "2027-01-15"))).toEqual(["2026-12-01", "2027-01-01"]);
  });

  it("timed: keeps time and duration; INTERVAL=2 weekly; exdate is the Seoul date", () => {
    const e = ev({
      id: "t",
      start: "2026-11-03T14:00:00+09:00",
      end: "2026-11-03T15:30:00+09:00",
      recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU",
      exdates: ["2026-12-01"],
    });
    const out = expand([e], "2026-11-01", "2026-12-31");
    expect(out.map((o) => [o.start, o.end])).toEqual([
      ["2026-11-03T14:00:00+09:00", "2026-11-03T15:30:00+09:00"],
      ["2026-11-17T14:00:00+09:00", "2026-11-17T15:30:00+09:00"],
      ["2026-12-15T14:00:00+09:00", "2026-12-15T15:30:00+09:00"],
      ["2026-12-29T14:00:00+09:00", "2026-12-29T15:30:00+09:00"],
    ]);
  });

  it("a multi-day occurrence that started before the range still overlaps it", () => {
    const e = ev({ id: "m", start: "2026-10-30", end: "2026-11-03", allDay: true, recurrence: "FREQ=MONTHLY" });
    expect(starts(expand([e], "2026-11-01", "2026-11-02"))).toEqual(["2026-10-30"]);
  });

  it("non-recurring events pass through untouched", () => {
    const e = ev({ id: "x" });
    expect(expand([e], "2030-01-01", "2030-02-01")).toEqual([e]);
  });

  it("rejects what it cannot expand", () => {
    for (const bad of ["", "BYDAY=MO", "FREQ=HOURLY", "FREQ=WEEKLY;BYSETPOS=1", "FREQ=WEEKLY;COUNT=0", "FREQ=WEEKLY;UNTIL=2025"])
      expect(() => parseRule(bad), bad).toThrow();
    expect(parseRule("RRULE:FREQ=WEEKLY;BYDAY=MO,WE")).toMatchObject({ freq: "WEEKLY", byDay: [1, 3] });
  });

  it("describes rules in Korean", () => {
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO", "2025-09-29")).toBe("매주 월요일");
    expect(describeRule("FREQ=WEEKLY;BYDAY=SA;COUNT=10", "2025-09-27")).toBe("매주 토요일, 10회");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=18", "2025-10-18")).toBe("매월 18일");
    expect(describeRule("FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=12;UNTIL=20301231", "2026-01-12")).toBe("매년 1월 12일, 2030-12-31까지");
    expect(describeRule("FREQ=WEEKLY;INTERVAL=2", "2026-11-03")).toBe("2주마다 화요일");
    expect(describeRule("FREQ=DAILY", "2026-11-03")).toBe("매일");
  });
});

describe("hasEnded (routine list)", () => {
  const today = "2026-11-17";
  it("UNTIL in the past: ended; UNTIL today or later: not ended", () => {
    expect(hasEnded(allDay("2025-09-29", "FREQ=WEEKLY;BYDAY=MO;UNTIL=20251201"), today)).toBe(true);
    expect(hasEnded(allDay("2025-09-29", "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261117"), today)).toBe(false);
    expect(hasEnded(allDay("2025-09-29", "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261201"), today)).toBe(false);
  });
  it("COUNT used up in the past: ended; COUNT with occurrences left: not ended", () => {
    expect(hasEnded(allDay("2025-09-29", "FREQ=WEEKLY;COUNT=10"), today)).toBe(true);
    expect(hasEnded(allDay("2026-11-02", "FREQ=WEEKLY;COUNT=10"), today)).toBe(false);
  });
  it("no end: never ended", () => {
    expect(hasEnded(allDay("2025-09-29", "FREQ=WEEKLY;BYDAY=MO"), today)).toBe(false);
  });
});

describe("routineList (hasEnded once per routine)", () => {
  const today = "2026-11-17";
  const r = (id: string, title: string, recurrence: string | undefined, deleted = false) =>
    ({ ...allDay("2025-09-29", "FREQ=WEEKLY;BYDAY=MO"), id, title, recurrence, deleted });
  const events = [
    r("done", "가", "FREQ=WEEKLY;BYDAY=MO;UNTIL=20251201"),
    r("b", "나", "FREQ=WEEKLY;BYDAY=MO"),
    r("a", "가", "FREQ=WEEKLY;BYDAY=MO"),
    r("gone", "삭제", "FREQ=WEEKLY", true),
    r("once", "한번", undefined),
  ];
  it("keeps only live recurring events, running ones first, then by title; ended ids in a set", () => {
    const { routines, ended } = routineList(events, today);
    expect(routines.map((e) => e.id)).toEqual(["a", "b", "done"]);
    expect([...ended]).toEqual(["done"]);
  });
});

// Session A (docs/ROUTINE_REPEAT_PLAN.md D1/D6): last day of month, Nth and last weekday.
describe("month ends and Nth weekdays", () => {
  const range = (e: ReturnType<typeof allDay>, from: string, to: string) => starts(expand([e], from, to));

  it("BYMONTHDAY=-1 is the last day of every month, leap February included", () => {
    expect(range(allDay("2026-01-31", "FREQ=MONTHLY;BYMONTHDAY=-1"), "2026-01-01", "2026-05-01"))
      .toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(range(allDay("2026-01-31", "FREQ=MONTHLY;BYMONTHDAY=-1"), "2028-02-01", "2028-03-01")).toEqual(["2028-02-29"]);
    expect(range(allDay("2026-01-30", "FREQ=MONTHLY;BYMONTHDAY=-2"), "2026-02-01", "2026-04-01")).toEqual(["2026-02-27", "2026-03-30"]);
  });

  it("BYDAY=2MO is the second Monday, not the start's day of month (RFC default)", () => {
    expect(range(allDay("2026-01-12", "FREQ=MONTHLY;BYDAY=2MO"), "2026-01-01", "2026-04-01"))
      .toEqual(["2026-01-12", "2026-02-09", "2026-03-09"]);
    expect(range(allDay("2026-01-12", "FREQ=MONTHLY;BYDAY=+2MO"), "2026-02-01", "2026-03-01")).toEqual(["2026-02-09"]);
  });

  it("BYDAY=-1FR is the last Friday; 5MO skips months without a fifth Monday", () => {
    expect(range(allDay("2026-01-30", "FREQ=MONTHLY;BYDAY=-1FR"), "2026-01-01", "2026-05-01"))
      .toEqual(["2026-01-30", "2026-02-27", "2026-03-27", "2026-04-24"]);
    expect(range(allDay("2026-03-30", "FREQ=MONTHLY;BYDAY=5MO"), "2026-03-01", "2026-09-01"))
      .toEqual(["2026-03-30", "2026-06-29", "2026-08-31"]);
  });

  it("a start that misses the rule: first occurrence is the next match", () => {
    expect(range(allDay("2026-01-01", "FREQ=MONTHLY;BYDAY=2MO"), "2026-01-01", "2026-02-01")).toEqual(["2026-01-12"]);
  });

  it("plain BYDAY in MONTHLY is every such weekday; with BYMONTHDAY both must hold", () => {
    expect(range(allDay("2026-02-02", "FREQ=MONTHLY;BYDAY=MO"), "2026-02-01", "2026-03-01"))
      .toEqual(["2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23"]);
    expect(range(allDay("2026-02-13", "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13"), "2026-01-01", "2027-01-01"))
      .toEqual(["2026-02-13", "2026-03-13", "2026-11-13"]);
  });

  it("YEARLY last day of February", () => {
    expect(range(allDay("2026-02-28", "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1"), "2026-01-01", "2029-01-01"))
      .toEqual(["2026-02-28", "2027-02-28", "2028-02-29"]);
  });

  it("INTERVAL with COUNT and UNTIL; exdates still count toward COUNT", () => {
    expect(range(allDay("2026-01-12", "FREQ=MONTHLY;INTERVAL=2;BYDAY=2MO;COUNT=3"), "2026-01-01", "2027-01-01"))
      .toEqual(["2026-01-12", "2026-03-09", "2026-05-11"]);
    expect(range(allDay("2026-01-31", "FREQ=MONTHLY;BYMONTHDAY=-1;UNTIL=20260430"), "2026-01-01", "2027-01-01"))
      .toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(range(allDay("2026-01-31", "FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3", ["2026-02-28"]), "2026-01-01", "2027-01-01"))
      .toEqual(["2026-01-31", "2026-03-31"]);
  });

  it("timed series on another zone matches its own dates (New York last Friday 23:00)", () => {
    const e = ev({
      id: "ny",
      start: "2026-01-30T23:00:00-05:00",
      end: "2026-01-30T23:30:00-05:00",
      tz: "America/New_York",
      recurrence: "FREQ=MONTHLY;BYDAY=-1FR",
    });
    expect(starts(expand([e], "2026-02-01", "2026-04-01"))).toEqual(["2026-02-27T23:00:00-05:00", "2026-03-27T23:00:00-04:00"]);
  });

  it("parses ordinals and negative days; rejects what RFC or this app does not allow", () => {
    expect(parseRule("FREQ=MONTHLY;BYDAY=2MO,-1FR,SU;BYMONTHDAY=-1,15")).toMatchObject({
      byDay: [0],
      byNth: [[2, 1], [-1, 5]],
      byMonthDay: [-1, 15],
    });
    for (const bad of [
      "FREQ=MONTHLY;BYDAY=0MO",
      "FREQ=MONTHLY;BYDAY=6MO",
      "FREQ=MONTHLY;BYDAY=-6MO",
      "FREQ=MONTHLY;BYDAY=2XX",
      "FREQ=MONTHLY;BYMONTHDAY=0",
      "FREQ=MONTHLY;BYMONTHDAY=-32",
      "FREQ=WEEKLY;BYDAY=2MO",
      "FREQ=DAILY;BYDAY=-1FR",
      "FREQ=YEARLY;BYDAY=4TH",
      "FREQ=MONTHLY;BYDAY=2MO;COUNT=3;UNTIL=20261231",
    ])
      expect(() => parseRule(bad), bad).toThrow();
  });

  it("describes them in Korean", () => {
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=-1", "2026-01-31")).toBe("매월 말일");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=-2", "2026-01-30")).toBe("매월 끝에서 2번째 날");
    expect(describeRule("FREQ=MONTHLY;BYDAY=2MO", "2026-01-12")).toBe("매월 둘째 월요일");
    expect(describeRule("FREQ=MONTHLY;BYDAY=-1FR", "2026-01-30")).toBe("매월 마지막 금요일");
    expect(describeRule("FREQ=MONTHLY;BYDAY=-2FR", "2026-01-23")).toBe("매월 끝에서 둘째 금요일");
    expect(describeRule("FREQ=MONTHLY;INTERVAL=2;BYDAY=2MO;COUNT=3", "2026-01-12")).toBe("2개월마다 둘째 월요일, 3회");
    expect(describeRule("FREQ=MONTHLY;BYDAY=MO", "2026-02-02")).toBe("매월 월요일");
    expect(describeRule("FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13", "2026-02-13")).toBe("매월 13일 금요일");
    expect(describeRule("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1", "2026-02-28")).toBe("매년 2월 말일");
  });
});
