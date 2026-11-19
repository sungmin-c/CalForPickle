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
    for (const bad of ["", "BYDAY=MO", "FREQ=HOURLY", "FREQ=MONTHLY;BYDAY=2MO", "FREQ=WEEKLY;BYSETPOS=1", "FREQ=WEEKLY;COUNT=0", "FREQ=WEEKLY;UNTIL=2025"])
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
