import { afterEach, describe, expect, it } from "vitest";
import { setLang, TEXT } from "../src/i18n";
import { describeRule } from "../src/recur";
import { calendarTitle } from "../src/ui/Calendar";
import { longDate } from "../src/ui/dates";

afterEach(() => setLang("ko"));

describe("text tables", () => {
  it("ko and en have the same keys, same kinds, no empty values", () => {
    const { ko, en } = TEXT as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
    for (const k of Object.keys(ko)) {
      expect(typeof en[k], k).toBe(typeof ko[k]);
      for (const v of [ko[k], en[k]]) {
        if (typeof v === "string") expect(v.trim(), k).not.toBe("");
        if (Array.isArray(v)) expect(v.flat().every((x) => typeof x === "string" && x !== ""), k).toBe(true);
      }
    }
  });
});

describe("English formats", () => {
  it("titles", () => {
    setLang("en");
    expect(calendarTitle("month", "2026-11-17")).toEqual({ main: "November", year: " 2026", short: "Nov 2026" });
    expect(calendarTitle("week", "2026-11-17")).toEqual({ main: "Nov 15 – 21", year: ", 2026", short: "11/15 – 21" });
    expect(calendarTitle("week", "2026-12-01")).toEqual({ main: "Nov 29 – Dec 5", year: ", 2026", short: "11/29 – 12/5" });
    setLang("ko");
    expect(calendarTitle("month", "2026-11-17")).toEqual({ main: "11월", year: "2026년 " });
    expect(calendarTitle("week", "2026-12-01")).toEqual({ main: "11월 29일 ~ 12월 5일", year: "2026년 ", short: "11.29 – 12.5" });
  });

  it("dates and rules", () => {
    setLang("en");
    expect(longDate("2026-11-15")).toBe("Sun, Nov 15, 2026");
    expect(longDate("2026-02-30")).toBe("");
    expect(describeRule("FREQ=WEEKLY", "2026-11-16T09:00:00+09:00")).toBe("Weekly on Mon");
    expect(describeRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=10", "2026-11-17T09:00:00+09:00")).toBe("Every 2 weeks on Tue, 10 times");
    expect(describeRule("FREQ=YEARLY;UNTIL=20301231", "2026-01-12")).toBe("Yearly on Jan 12, until 2030-12-31");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=1,15", "2026-01-01")).toBe("Monthly on day 1, 15");
    expect(describeRule("FREQ=DAILY", "2026-01-01")).toBe("Daily");
  });
});
