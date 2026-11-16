import { describe, expect, it } from "vitest";
import {
  cellTasks,
  cleanTitle,
  fontColor,
  type EventRow,
  IMPORT_NS,
  localStamp,
  monthCounts,
  planMerge,
  sourceEvent,
  statusFor,
  uuidV5,
} from "../scripts/importDesktopcal";
import { normalizeEvent, normalizeTask, serializeTasks } from "../src/model";
import { task } from "./fixtures";

const cell = (o: Partial<{ key: string; content: string; cdate: string; mdate: string }> = {}) => ({
  key: "dkcal_mdays_20261120",
  content: "우유\r\n[+] 장보기 |&gt;| 우유",
  cdate: "2026-11-19 08:00:00",
  mdate: "2026-11-20 21:30:05",
  ...o,
});

describe("uuid-v5", () => {
  it("matches RFC 4122 vectors (checked with Python uuid.uuid5)", async () => {
    expect(await uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
    expect(await uuidV5("dkcal:20261120:장보기 |&gt;| 우유", IMPORT_NS)).toBe("2cbd0346-ae16-5d97-b4bc-c198ca452eae");
  });

  it("is idempotent: the same cell always yields byte-identical tasks", async () => {
    const a = serializeTasks(await cellTasks(cell()));
    const b = serializeTasks(await cellTasks(cell()));
    expect(a).toBe(b);
  });

  it("keys on date + body, not line index: done toggle and reordering keep ids", async () => {
    const before = await cellTasks(cell({ content: "우유\r\n빵" }));
    const after = await cellTasks(cell({ content: "[+] 빵\r\n[+]우유" }));
    const ids = (ts: { id: string; title: string }[]) => Object.fromEntries(ts.map((t) => [t.title, t.id]));
    expect(ids(after)).toEqual(ids(before));
    expect(ids(before)["우유"]).toBe("034a8d0e-0263-5169-a1eb-147cfc8a4eaf");
  });

  it("numbers repeated bodies in one cell so ids stay unique", async () => {
    const ts = await cellTasks(cell({ content: "우유\r\n우유" }));
    expect(ts.map((t) => t.id)).toEqual(["034a8d0e-0263-5169-a1eb-147cfc8a4eaf", "c15fede4-8668-57ab-8606-d9ebb1138083"]);
  });
});

describe("time conversion", () => {
  it("reads the app's local wall clock as Seoul time with ms", () => {
    expect(localStamp("2026-11-20 21:30:05")).toBe("2026-11-20T21:30:05.000+09:00");
    expect(() => localStamp("2026-11-20")).toThrow();
  });

  it("updatedAt is the later of cdate/mdate; due is the cell date", async () => {
    const [t] = await cellTasks(cell({ content: "a", cdate: "2026-11-21 09:00:00", mdate: "2026-11-20 09:00:00" }));
    expect(t.updatedAt).toBe("2026-11-21T09:00:00.000+09:00");
    expect(t.due).toBe("2026-11-20");
  });
});

describe("title cleanup", () => {
  it("drops [+], restores pipe-wrapped entities, trims; keeps markdown", () => {
    expect(cleanTitle("[+] 장보기 |&gt;| 우유 ")).toBe("장보기 > 우유");
    expect(cleanTitle("|&lt;|a|&gt;| |&quot;|b|&quot;| |&#039;|c |&amp;| **d**")).toBe(`<a> "b" 'c & **d**`);
  });
});

describe("font color (session 9)", () => {
  it("a title wrapped in one <font color> becomes plain text + color; anything else is left as typed", () => {
    expect(fontColor('<font color="#f12424">회의 101</font>')).toEqual({ title: "회의 101", color: "#F12424" });
    expect(fontColor("  <font color=\"#00FF00\"> a </font> ")).toEqual({ title: "a", color: "#00FF00" });
    expect(fontColor("a <b> c")).toEqual({ title: "a <b> c" });
    expect(fontColor('x <font color="#FF0000">y</font>')).toEqual({ title: 'x <font color="#FF0000">y</font>' });
  });

  it("cell lines and events get the color; task ids still come from the raw line, so re-import keeps them", async () => {
    const raw = '|&lt;|font color=|&quot;|#F12424|&quot;||&gt;|시험|&lt;|/font|&gt;|';
    const [t] = await cellTasks(cell({ content: raw }));
    expect(t).toMatchObject({ title: "시험", color: "#F12424" });
    expect(t.id).toBe(await uuidV5(`dkcal:20261120:${raw}`, IMPORT_NS));
    expect(normalizeTask(JSON.parse(JSON.stringify(t)))).toEqual(t);
    const e = (await sourceEvent({
      uid: "u", content: raw, start: "2025-09-27T00:00:00.000+0900", status: 1, rec: '{"RRULE":{"FREQ":"YEARLY"}}',
      info: "{}", cdate: "2025-01-01T03:00:00.000000Z", mdate: "2025-01-01T03:00:00.000000Z",
    }))!;
    expect(e).toMatchObject({ title: "시험", color: "#F12424" });
    expect(normalizeEvent(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });
});

describe("status / deleted mapping", () => {
  it("[+] is done; unmarked is todo from 2026, done before 2026 (marks were not used then)", () => {
    expect(statusFor(true, "2026-11-20")).toBe("done");
    expect(statusFor(false, "2026-01-01")).toBe("todo");
    expect(statusFor(false, "2025-12-31")).toBe("done");
  });

  it("emits schema-valid tasks: never deleted, no priority key, blank lines skipped", async () => {
    const ts = await cellTasks(cell({ content: "\r\n  \r\n[+] x\r\ny" }));
    expect(ts).toHaveLength(2);
    for (const t of ts) {
      expect(normalizeTask(JSON.parse(JSON.stringify(t)))).toEqual(t);
      expect(t.deleted).toBe(false);
      expect("priority" in t).toBe(false);
      expect(t.notes).toBe("");
    }
    expect(ts.map((t) => t.status)).toEqual(["done", "todo"]);
  });
});

describe("month distribution", () => {
  it("counts tasks per due month (Seoul calendar date of the cell) by status", () => {
    const ts = [
      task({ id: "a", due: "2025-12-31", status: "done" }),
      task({ id: "b", due: "2026-01-01" }),
      task({ id: "c", due: "2026-01-31", status: "done" }),
    ];
    expect(monthCounts(ts)).toEqual([
      ["2025-12", { todo: 0, done: 1 }],
      ["2026-01", { todo: 1, done: 1 }],
    ]);
  });
});

describe("LWW against the existing local copy", () => {
  it("adds new ids, updates older ones, keeps newer local edits and local deletes", () => {
    const imp = [
      task({ id: "new", updatedAt: "2026-01-01T00:00:00.000+09:00" }),
      task({ id: "old", status: "done", updatedAt: "2026-01-02T00:00:00.000+09:00" }),
      task({ id: "edited", updatedAt: "2026-01-02T00:00:00.000+09:00" }),
      task({ id: "same", updatedAt: "2026-01-02T00:00:00.000+09:00" }),
    ];
    const local = [
      task({ id: "old", updatedAt: "2026-01-01T00:00:00.000+09:00" }),
      task({ id: "edited", deleted: true, updatedAt: "2026-11-01T00:00:00.000+09:00" }),
      task({ id: "same", updatedAt: "2026-01-02T00:00:00.000+09:00" }),
      task({ id: "mine", updatedAt: "2026-11-01T00:00:00.000+09:00" }),
    ];
    const p = planMerge(local, imp);
    expect(p.counts).toEqual({ added: 1, updated: 1, unchanged: 1, keptLocal: 1 });
    expect(p.merged.map((t) => t.id)).toEqual(["edited", "mine", "new", "old", "same"]);
    expect(p.merged.find((t) => t.id === "edited")!.deleted).toBe(true);
    expect(p.merged.find((t) => t.id === "old")!.status).toBe("done");
  });
});

describe("recurring events (session 7, R1~R6)", () => {
  const q = (s: string) => s.replace(/"/g, "|&quot;|");
  const row = (o: Partial<EventRow> = {}): EventRow => ({
    uid: "event-20250101-000000-000-0",
    content: "주간 |&gt;| 모임",
    start: "2025-09-27T00:00:00.000+0900",
    status: 1,
    rec: '{"RRULE":{"FREQ":"WEEKLY","BYWEEK":"SA","COUNT":10}}',
    info: q('{"CMPEDATE":"","COUNTDOWNSHOWTYPE":0,"COUNTDOWNTYPE":0,"DELDATE":"20251004"}'),
    cdate: "2025-01-01T03:00:00.000000Z",
    mdate: "2025-01-01T03:00:00.000000Z",
    ...o,
  });

  it("maps to a one-day all-day event with RRULE, exdates, uuid-v5 id and Seoul updatedAt", async () => {
    expect(await sourceEvent(row())).toEqual({
      id: await uuidV5("dkcal-ev:event-20250101-000000-000-0", IMPORT_NS),
      title: "주간 > 모임",
      start: "2025-09-27",
      end: "2025-09-28",
      allDay: true,
      recurrence: "FREQ=WEEKLY;BYDAY=SA;COUNT=10",
      exdates: ["2025-10-04"],
      location: "",
      notes: "",
      updatedAt: "2025-01-01T12:00:00.000+09:00",
      deleted: false,
    });
  });

  it("UNTIL keeps the date only (inclusive); monthly/yearly BY* carry over; no DELDATE = no exdates", async () => {
    const e = await sourceEvent(row({ rec: '{"RRULE":{"FREQ":"WEEKLY","BYWEEK":"SU","UNTIL":"20251207T235959"}}', info: q('{"CMPEDATE":""}') }));
    expect(e).toMatchObject({ recurrence: "FREQ=WEEKLY;BYDAY=SU;UNTIL=20251207" });
    expect(e).not.toHaveProperty("exdates");
    expect((await sourceEvent(row({ rec: '{"RRULE":{"FREQ":"YEARLY","BYMONTHDAY":12,"BYMONTH":1}}' })))!.recurrence)
      .toBe("FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=12");
  });

  it("skips ev_status 2 and rejects unknown RRULE keys", async () => {
    expect(await sourceEvent(row({ status: 2 }))).toBeNull();
    await expect(sourceEvent(row({ rec: '{"RRULE":{"FREQ":"WEEKLY","BYSETPOS":1}}' }))).rejects.toThrow();
  });

  it("the result passes the app's own schema check", async () => {
    const e = (await sourceEvent(row()))!;
    expect(normalizeEvent(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });
});
