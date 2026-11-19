import { calendarTitle } from "../src/ui/Calendar";
import { setZone, ZONE } from "../src/zone";
const home = ZONE;
import { describe, expect, it } from "vitest";
import { addMonths, fromForm, longDate, monthDays, onDay, toForm, weekDays } from "../src/ui/dates";
import { ev } from "./fixtures";

describe("calendar grid (Sunday start)", () => {
  it("month grid starts on the Sunday before the 1st and ends on a Saturday", () => {
    const days = monthDays("2026-11-15"); // 2026-11-01 is a Sunday
    expect(days[0]).toBe("2026-11-01");
    expect(days.length).toBe(35);
    expect(days[days.length - 1]).toBe("2026-12-05");
    expect(monthDays("2026-12-03")[0]).toBe("2026-11-29");
  });
  it("week runs Sunday to Saturday", () => {
    expect(weekDays("2026-11-18")).toEqual([
      "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21",
    ]);
  });
  it("month step clamps the day (Jan 31 -> Feb 28)", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("event on day", () => {
  it("all-day end is exclusive", () => {
    const e = ev({ id: "a", allDay: true, start: "2026-11-20", end: "2026-11-22" });
    expect(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((d) => onDay(e, d))).toEqual([
      false, true, true, false,
    ]);
  });
  it("timed event ending at midnight stays on its day; zero length shows on start day", () => {
    const e = ev({ id: "b", start: "2026-11-20T23:00:00+09:00", end: "2026-11-21T00:00:00+09:00" });
    expect(onDay(e, "2026-11-20")).toBe(true);
    expect(onDay(e, "2026-11-21")).toBe(false);
    const z = ev({ id: "c", start: "2026-11-20T10:00:00+09:00", end: "2026-11-20T10:00:00+09:00" });
    expect(onDay(z, "2026-11-20")).toBe(true);
  });
});

describe("event form round trip", () => {
  it("all-day shows the inclusive last day and stores the exclusive end", () => {
    const e = ev({ id: "a", allDay: true, start: "2026-11-20", end: "2026-11-21" });
    const f = toForm(e);
    expect([f.startDate, f.endDate]).toEqual(["2026-11-20", "2026-11-20"]);
    expect(fromForm(f, e)).toMatchObject({ start: "2026-11-20", end: "2026-11-21" });
  });
  it("times show in the PC's zone; unchanged ones keep their stored text, changed ones take the PC's offset (Q19)", () => {
    setZone("Asia/Seoul");
    const e = ev({ id: "b", start: "2026-11-20T05:00:00Z", end: "2026-11-20T06:30:00Z" });
    const f = toForm(e);
    expect([f.startTime, f.endTime]).toEqual(["14:00", "15:30"]);
    expect(fromForm(f, e)).toMatchObject({ start: e.start, end: e.end });
    expect(fromForm({ ...f, endTime: "16:00" }, e)).toMatchObject({ start: "2026-11-20T14:00:00+09:00", end: "2026-11-20T16:00:00+09:00", tz: "Asia/Seoul" });
    setZone(home);
  });
  it("rejects an end before the start", () => {
    const e = ev({ id: "c" });
    expect(typeof fromForm({ ...toForm(e), endTime: "13:00" }, e)).toBe("string");
  });
});

describe("longDate: Korean reading of a date input (session 12)", () => {
  it("spells year, month, day and weekday", () => {
    expect(longDate("2026-02-01")).toBe("2026년 2월 1일 (일)");
    expect(longDate("2026-11-21")).toBe("2026년 11월 21일 (토)");
  });
  it("is empty for an empty or half-typed input", () => {
    expect(longDate("")).toBe("");
    expect(longDate("2026-13-01")).toBe("");
  });
});

describe("weekShortTitle (narrow header)", () => {
  it("drops the month on the end date only when the week stays in one month", () => {
    expect(calendarTitle("week", "2026-11-16").short).toBe("11.15 – 21");
    expect(calendarTitle("week", "2026-12-01").short).toBe("11.29 – 12.5");
  });
});
