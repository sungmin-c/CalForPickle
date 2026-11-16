import { describe, expect, it } from "vitest";
import { generateUpcoming } from "../src/upcoming";
import { ev, task } from "./fixtures";

const now = new Date("2026-11-15T07:00:03.120+09:00");

describe("7. upcoming", () => {
  it("covers today through 14 days (to exclusive)", () => {
    const u = generateUpcoming(
      [
        ev({ id: "last-in", start: "2026-11-28T23:00:00+09:00", end: "2026-11-28T23:30:00+09:00" }),
        ev({ id: "first-out", start: "2026-11-29T00:00:00+09:00", end: "2026-11-29T01:00:00+09:00" }),
        ev({ id: "first-in", start: "2026-11-15T00:00:00+09:00", end: "2026-11-15T00:30:00+09:00" }),
        ev({ id: "gone", start: "2026-11-16T09:00:00+09:00", end: "2026-11-16T10:00:00+09:00", deleted: true }),
      ],
      [],
      now,
    );
    expect(u.generatedAt).toBe("2026-11-15T07:00:03.120+09:00");
    expect(u.from).toBe("2026-11-15");
    expect(u.to).toBe("2026-11-29");
    expect(u.events.map((e) => e.id)).toEqual(["first-in", "last-in"]);
  });

  it("all-day end is exclusive: ended yesterday is out, spanning today is in", () => {
    const u = generateUpcoming(
      [
        ev({ id: "yesterday", start: "2026-11-14", end: "2026-11-15", allDay: true }),
        ev({ id: "spanning", start: "2026-11-13", end: "2026-11-16", allDay: true }),
        ev({ id: "on-to", start: "2026-11-29", end: "2026-11-30", allDay: true }),
      ],
      [],
      now,
    );
    expect(u.events).toEqual([
      { id: "spanning", title: "t", start: "2026-11-13", end: "2026-11-16", allDay: true, location: "" },
    ]);
  });

  it("lists each occurrence of a recurring event in range under the event's id", () => {
    const u = generateUpcoming(
      [ev({ id: "w", start: "2025-09-29", end: "2025-09-30", allDay: true, recurrence: "FREQ=WEEKLY;BYDAY=MO", exdates: ["2026-11-23"] })],
      [],
      now,
    );
    expect(u.events.map((e) => [e.id, e.start, e.end])).toEqual([
      ["w", "2026-11-16", "2026-11-17"],
    ]);
  });

  it("keeps open tasks (undated last), drops done and deleted, omits notes", () => {
    const u = generateUpcoming(
      [],
      [
        task({ id: "c" }),
        task({ id: "b", due: "2026-12-31", status: "doing", priority: "high" }),
        task({ id: "a", due: "2026-11-20" }),
        task({ id: "d", status: "done" }),
        task({ id: "e", deleted: true }),
      ],
      now,
    );
    expect(u.tasks).toEqual([
      { id: "a", title: "t", status: "todo", due: "2026-11-20" },
      { id: "b", title: "t", status: "doing", due: "2026-12-31", priority: "high" },
      { id: "c", title: "t", status: "todo" },
    ]);
  });
});
