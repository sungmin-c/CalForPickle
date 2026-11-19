import { describe, expect, it } from "vitest";
import { holidayName, usHolidayName } from "../src/holidays";

describe("Korean public holidays", () => {
  it("fixed-date holidays", () => {
    expect(holidayName("2026-01-01")).toBe("신정");
    expect(holidayName("2026-03-01")).toBe("삼일절");
    expect(holidayName("2026-06-06")).toBe("현충일");
    expect(holidayName("2026-12-25")).toBe("성탄절");
    expect(holidayName("2026-10-09")).toBe("한글날");
  });

  it("lunar holidays: 설날 (with eve and day after), 부처님오신날, 추석", () => {
    expect(["2026-02-16", "2026-02-17", "2026-02-18"].map(holidayName)).toEqual(["설날 연휴", "설날", "설날 연휴"]);
    expect(holidayName("2026-05-24")).toBe("부처님오신날");
    expect(["2026-09-24", "2026-09-25", "2026-09-26"].map(holidayName)).toEqual(["추석 연휴", "추석", "추석 연휴"]);
    expect(holidayName("2025-01-29")).toBe("설날");
    expect(holidayName("2025-10-06")).toBe("추석");
  });

  it("substitute holidays: single-day holiday on a weekend moves to the next free weekday", () => {
    expect(holidayName("2026-05-25")).toBe("대체공휴일(부처님오신날)"); // 5/24 is a Sunday
    expect(holidayName("2026-08-17")).toBe("대체공휴일(광복절)"); // 8/15 is a Saturday
    expect(holidayName("2026-10-05")).toBe("대체공휴일(개천절)"); // 10/3 is a Saturday
    expect(holidayName("2026-03-02")).toBe("대체공휴일(삼일절)"); // 3/1 is a Sunday
  });

  it("substitute holidays: 설날/추석 block only when it overlaps a Sunday", () => {
    expect(holidayName("2025-10-08")).toBe("대체공휴일(추석)"); // 10/5 (Sun) is 추석 연휴
    expect(holidayName("2026-09-28")).toBeUndefined(); // 9/24-26 is Thu-Sat: no substitute
  });

  it("no substitute for 현충일 or 신정; ordinary days are not holidays", () => {
    expect(holidayName("2026-06-08")).toBeUndefined(); // 6/6 is a Saturday
    expect(holidayName("2026-11-17")).toBeUndefined();
  });

  it("노동절 (5/1) and 제헌절 (7/17) are holidays from 2026, with substitutes (2027 월력요항)", () => {
    expect(holidayName("2026-05-01")).toBe("노동절"); // Friday
    expect(holidayName("2026-07-17")).toBe("제헌절"); // Friday
    expect(holidayName("2026-05-04")).toBeUndefined();
    expect(holidayName("2026-07-20")).toBeUndefined();
    expect(holidayName("2027-05-01")).toBe("노동절"); // Saturday
    expect(holidayName("2027-05-03")).toBe("대체공휴일(노동절)");
    expect(holidayName("2027-07-17")).toBe("제헌절"); // Saturday
    expect(holidayName("2027-07-19")).toBe("대체공휴일(제헌절)");
    expect(holidayName("2028-05-01")).toBe("노동절"); // Monday: no substitute
    expect(holidayName("2029-05-01")).toBe("노동절"); // Tuesday
    expect(holidayName("2029-05-02")).toBeUndefined();
    expect(holidayName("2028-07-17")).toBe("제헌절");
    expect(holidayName("2028-07-18")).toBeUndefined();
  });

  it("노동절 and 제헌절 are not holidays before 2026, and no substitutes appear", () => {
    for (const d of ["2025-05-01", "2025-07-17", "2024-05-01", "2024-07-17", "2021-07-17", "2021-07-19", "2022-05-01", "2022-05-02", "2023-05-01"])
      expect(holidayName(d), d).toBeUndefined();
  });

  it("temporary holiday table", () => {
    expect(holidayName("2026-06-03")).toBe("지방선거일");
  });
});

describe("US federal holidays (English)", () => {
  it("weekday rules", () => {
    expect(usHolidayName("2027-01-18")).toBe("Martin Luther King Jr. Day"); // 3rd Monday of January
    expect(usHolidayName("2026-02-16")).toBe("Presidents' Day");
    expect(usHolidayName("2026-05-25")).toBe("Memorial Day"); // last Monday of May
    expect(usHolidayName("2026-09-07")).toBe("Labor Day");
    expect(usHolidayName("2026-10-12")).toBe("Columbus Day");
    expect(usHolidayName("2026-11-26")).toBe("Thanksgiving"); // 4th Thursday
    expect(usHolidayName("2027-05-31")).toBe("Memorial Day");
  });

  it("fixed days and observed days", () => {
    expect(usHolidayName("2026-06-19")).toBe("Juneteenth");
    expect(usHolidayName("2026-11-11")).toBe("Veterans Day");
    expect(usHolidayName("2026-07-04")).toBe("Independence Day"); // Saturday
    expect(usHolidayName("2026-07-03")).toBe("Independence Day (observed)");
    expect(usHolidayName("2027-12-25")).toBe("Christmas Day"); // Saturday
    expect(usHolidayName("2027-12-24")).toBe("Christmas Day (observed)");
    expect(usHolidayName("2028-01-01")).toBe("New Year's Day"); // Saturday: observed the Friday before, in 2027
    expect(usHolidayName("2027-12-31")).toBe("New Year's Day (observed)");
    expect(usHolidayName("2023-01-02")).toBe("New Year's Day (observed)"); // 1/1 was a Sunday
  });

  it("no Korean holidays, no ordinary days", () => {
    expect(usHolidayName("2026-03-01")).toBeUndefined();
    expect(usHolidayName("2026-11-17")).toBeUndefined();
    expect(usHolidayName("2026-10-31")).toBeUndefined(); // Halloween is not a federal holiday
  });
});
