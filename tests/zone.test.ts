// Local time zone (session 23): screen, input and storage follow the PC's zone. New York covers DST; Seoul has none.
import { afterEach, describe, expect, it } from "vitest";
import { at, dateIn, offsetMin, setZone, stampIn, ZONE } from "../src/zone";
import { describeRule, expand } from "../src/recur";
import { eventPath } from "../src/partition";
import { shouldDailyPull } from "../src/sync";
import { generateUpcoming } from "../src/upcoming";
import { fromForm, onDay, timeLabel, toForm } from "../src/ui/dates";
import { ev } from "./fixtures";

const NY = "America/New_York";
const home = ZONE;
afterEach(() => setZone(home));

describe("zone helpers", () => {
  it("offset: fixed strings and IANA zones across DST", () => {
    expect(offsetMin(0, "+09:00")).toBe(540);
    expect(offsetMin(0, "-05:30")).toBe(-330);
    expect(offsetMin(0, "Z")).toBe(0);
    expect(offsetMin(Date.parse("2026-07-01T12:00:00Z"), NY)).toBe(-240);
    expect(offsetMin(Date.parse("2026-12-01T12:00:00Z"), NY)).toBe(-300);
    expect(offsetMin(Date.parse("2026-12-01T12:00:00Z"), "Asia/Seoul")).toBe(540);
  });

  it("a Seoul Monday 09:00 is Sunday 19:00 in New York", () => {
    const ms = Date.parse("2026-11-23T09:00:00+09:00");
    expect(dateIn(ms, NY)).toBe("2026-11-22");
    expect(stampIn(ms, NY)).toBe("2026-11-22T19:00:00.000-05:00");
    expect(stampIn(ms, "Asia/Seoul")).toBe("2026-11-23T09:00:00.000+09:00");
  });

  it("wall time to instant, and the 23-hour DST day", () => {
    expect(at("2026-07-01", "09:00", NY)).toBe(Date.parse("2026-07-01T09:00:00-04:00"));
    expect(at("2026-12-01", "09:00", NY)).toBe(Date.parse("2026-12-01T09:00:00-05:00"));
    expect(at("2026-03-09", "00:00", NY) - at("2026-03-08", "00:00", NY)).toBe(23 * 3600_000);
    expect(at("2026-11-02", "00:00", NY) - at("2026-11-01", "00:00", NY)).toBe(25 * 3600_000);
  });
});

describe("app in New York", () => {
  it("a weekly event with tz keeps 09:00 local across the DST change", () => {
    setZone(NY);
    const e = ev({ id: "w", start: "2026-10-26T09:00:00-04:00", end: "2026-10-26T10:00:00-04:00", tz: NY, recurrence: "FREQ=WEEKLY" });
    const [a, b] = expand([e], "2026-10-26", "2026-11-03");
    expect([a.start, b.start]).toEqual(["2026-10-26T09:00:00-04:00", "2026-11-02T09:00:00-05:00"]);
    expect(Date.parse(b.end) - Date.parse(b.start)).toBe(3600_000);
  });

  it("without tz the series keeps the fixed offset of start (08:00 New York after DST ends)", () => {
    setZone(NY);
    const e = ev({ id: "w", start: "2026-10-26T09:00:00-04:00", end: "2026-10-26T10:00:00-04:00", recurrence: "FREQ=WEEKLY" });
    const occ = expand([e], "2026-11-02", "2026-11-03");
    expect(occ.map((o) => timeLabel(o))).toEqual(["08:00"]);
  });

  it("a Seoul series is matched on Seoul dates and shown on the New York day it falls on", () => {
    setZone(NY);
    const e = ev({ id: "s", start: "2026-11-16T09:00:00+09:00", end: "2026-11-16T10:00:00+09:00", recurrence: "FREQ=WEEKLY;BYDAY=MO", exdates: ["2026-11-30"] });
    const occ = expand([e], "2026-11-22", "2026-12-06");
    expect(occ.map((o) => o.start)).toEqual(["2026-11-23T09:00:00+09:00"]); // 11-30 skipped by its Seoul date
    expect(onDay(occ[0], "2026-11-22")).toBe(true);
    expect(onDay(occ[0], "2026-11-23")).toBe(false);
    expect(timeLabel(occ[0])).toBe("19:00");
  });

  it("UNTIL without an offset is read in the series' own zone", () => {
    setZone(NY);
    const e = ev({ id: "u", start: "2026-11-02T09:00:00-05:00", end: "2026-11-02T10:00:00-05:00", tz: NY, recurrence: "FREQ=DAILY;UNTIL=20261104T090000" });
    expect(expand([e], "2026-11-01", "2026-11-10").length).toBe(3);
  });

  it("all-day events stay on their date in any zone", () => {
    setZone(NY);
    const e = ev({ id: "a", allDay: true, start: "2026-11-26", end: "2026-11-27", recurrence: "FREQ=YEARLY" });
    const occ = expand([e], "2026-11-01", "2027-12-01");
    expect(occ.map((o) => o.start)).toEqual(["2026-11-26", "2027-11-26"]);
    expect(onDay(occ[0], "2026-11-26")).toBe(true);
    expect(onDay(occ[0], "2026-11-25")).toBe(false);
    expect(onDay(occ[0], "2026-11-27")).toBe(false);
  });

  it("rule text says which zone a series runs on when it is not the PC's", () => {
    setZone(NY);
    expect(describeRule("FREQ=WEEKLY", "2026-11-16T09:00:00+09:00")).toBe("매주 월요일 (UTC+09:00 기준)");
    expect(describeRule("FREQ=WEEKLY", "2026-11-16T09:00:00-05:00", NY)).toBe("매주 월요일");
    setZone("Asia/Seoul");
    expect(describeRule("FREQ=WEEKLY", "2026-11-16T09:00:00+09:00")).toBe("매주 월요일");
  });

  it("month file follows the date written in start, on every PC", () => {
    setZone(NY);
    expect(eventPath(ev({ id: "m", start: "2026-11-30T20:00:00-05:00", end: "2026-11-30T21:00:00-05:00" }))).toBe("data/events/2026-11.json");
    expect(eventPath(ev({ id: "m", start: "2026-12-01T09:00:00+09:00", end: "2026-12-01T10:00:00+09:00" }))).toBe("data/events/2026-12.json");
  });

  it("the daily pull is 07:00 New York time", () => {
    setZone(NY);
    const now = new Date("2026-11-20T07:30:00-05:00");
    expect(shouldDailyPull(now, "2026-11-20T06:59:00.000-05:00")).toBe(true);
    expect(shouldDailyPull(now, "2026-11-20T07:01:00.000-05:00")).toBe(false);
    expect(shouldDailyPull(new Date("2026-11-20T06:30:00-05:00"), "2026-11-19T07:01:00.000-05:00")).toBe(false);
  });

  it("upcoming.json uses the local day and stamps", () => {
    setZone(NY);
    const u = generateUpcoming([], [], new Date("2026-11-20T22:00:00-05:00")); // already Nov 21 in Seoul
    expect([u.from, u.to, u.generatedAt]).toEqual(["2026-11-20", "2026-12-04", "2026-11-20T22:00:00.000-05:00"]);
  });

  it("the form reads and writes local time, tagging the zone", () => {
    setZone(NY);
    const seoul = ev({ id: "f", start: "2026-11-23T09:00:00+09:00", end: "2026-11-23T10:00:00+09:00" });
    const f = toForm(seoul);
    expect([f.startDate, f.startTime, f.endTime]).toEqual(["2026-11-22", "19:00", "20:00"]);
    // Title only: the stored times and zone stay as they were.
    expect(fromForm({ ...f, title: "x" }, seoul)).toMatchObject({ start: seoul.start, end: seoul.end, title: "x" });
    expect((fromForm({ ...f, title: "x" }, seoul) as { tz?: string }).tz).toBeUndefined();
    // A changed time is written with the local offset and zone.
    expect(fromForm({ ...f, startTime: "18:00" }, seoul)).toMatchObject({
      start: "2026-11-22T18:00:00-05:00", end: "2026-11-22T20:00:00-05:00", tz: NY,
    });
    // All-day drops the zone.
    expect((fromForm({ ...f, allDay: true }, { ...seoul, tz: NY }) as { tz?: string }).tz).toBeUndefined();
  });
});
