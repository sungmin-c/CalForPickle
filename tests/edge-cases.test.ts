// Boundary inputs that hold today (handoff session, 2026-11-17). A safety net for refactors of sync/recur/model/holidays.
// The inputs that break are in handoff-bugs.test.ts.
import { describe, expect, it } from "vitest";
import { holidayName } from "../src/holidays";
import { mergeItems, pruneTombstones } from "../src/merge";
import { dateIn } from "../src/zone";
import { instant, nextStamp, parseEvents, parseTasks, serializeEvents, serializeTasks } from "../src/model";
import { eventPath } from "../src/partition";
import { expand, hasEnded } from "../src/recur";
import { createSync, shouldDailyPull, type Local, type Remote } from "../src/sync";
import { addDays, addMonths, monthDays, onDay } from "../src/ui/dates";
import { generateUpcoming } from "../src/upcoming";
import { ev, task } from "./fixtures";

const at = (s: string) => new Date(s);
const starts = (es: { start: string }[]) => es.map((e) => e.start);
const allDay = (start: string, recurrence: string, exdates?: string[]) =>
  ev({ id: "r", start, end: addDays(start, 1), allDay: true, recurrence, exdates });

describe("date boundaries", () => {
  it("the Seoul day turns over at 15:00 UTC, across a year end too", () => {
    expect(dateIn(Date.parse("2026-12-31T14:59:59.999Z"), "+09:00")).toBe("2026-12-31");
    expect(dateIn(Date.parse("2026-12-31T15:00:00.000Z"), "+09:00")).toBe("2027-01-01");
    expect(eventPath(ev({ id: "a", start: "2026-12-31T15:30:00Z" }))).toBe("data/events/2026-12.json"); // the month written in start (Q17)
    expect(instant("2026-11-20")).toBe(Date.parse("2026-11-19T15:00:00Z"));
  });

  it("month steps clamp to the month end, leap years included", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("day steps cross leap days and non-leap centuries", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-28", 2)).toBe("2028-03-01");
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("month grid is 4 rows for a 28-day month starting on Sunday and 6 rows for a long month starting late", () => {
    expect(monthDays("2026-02-10")).toHaveLength(28);
    expect(monthDays("2026-08-10")).toHaveLength(42);
  });

  it("an event crossing midnight is on both days", () => {
    const e = ev({ id: "n", start: "2026-11-20T23:00:00+09:00", end: "2026-11-21T01:00:00+09:00" });
    expect(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((d) => onDay(e, d))).toEqual([false, true, true, false]);
  });
});

describe("recurrence end conditions and month ends", () => {
  it("yearly on Feb 29 only lands in leap years", () => {
    expect(starts(expand([allDay("2028-02-29", "FREQ=YEARLY")], "2028-01-01", "2037-01-01")))
      .toEqual(["2028-02-29", "2032-02-29", "2036-02-29"]);
  });

  it("monthly on the 30th skips February", () => {
    expect(starts(expand([allDay("2026-11-30", "FREQ=MONTHLY")], "2026-11-01", "2027-04-01")))
      .toEqual(["2026-11-30", "2026-12-30", "2027-01-30", "2027-03-30"]);
  });

  it("COUNT=1 is the start only; UNTIL before the start gives nothing", () => {
    expect(starts(expand([allDay("2026-11-02", "FREQ=DAILY;COUNT=1")], "2026-11-01", "2026-12-01"))).toEqual(["2026-11-02"]);
    expect(expand([allDay("2026-11-02", "FREQ=DAILY;UNTIL=20261101")], "2026-01-01", "2027-01-01")).toEqual([]);
  });

  it("UNTIL with a time is inclusive to the second; a bare UNTIL date covers a late-evening occurrence", () => {
    const e = (until: string, time = "14:00") => ev({
      id: "u", start: `2026-11-10T${time}:00+09:00`, end: `2026-11-10T${time}:30+09:00`, recurrence: `FREQ=WEEKLY;UNTIL=${until}`,
    });
    const days = (x: ReturnType<typeof e>) => starts(expand([x], "2026-11-01", "2026-12-01")).map((s) => s.slice(0, 10));
    expect(days(e("20261117T050000Z"))).toEqual(["2026-11-10", "2026-11-17"]);
    expect(days(e("20261117T045959Z"))).toEqual(["2026-11-10"]);
    expect(days(e("20261117", "23:30"))).toEqual(["2026-11-10", "2026-11-17"]);
  });

  it("a start written in UTC recurs on its UTC weekday (series keep their own offset, Q18)", () => {
    const e = ev({ id: "z", start: "2026-11-02T15:30:00Z", end: "2026-11-02T16:00:00Z", recurrence: "FREQ=WEEKLY;COUNT=2" });
    expect(starts(expand([e], "2026-11-01", "2026-12-01"))).toEqual(["2026-11-02T15:30:00+00:00", "2026-11-09T15:30:00+00:00"]);
  });

  it("every-other-month crosses the year; every-other-week counts weeks from Monday", () => {
    expect(starts(expand([allDay("2026-11-30", "FREQ=MONTHLY;INTERVAL=2")], "2026-11-01", "2027-06-01")))
      .toEqual(["2026-11-30", "2027-01-30", "2027-03-30", "2027-05-30"]);
    expect(starts(expand([allDay("2026-11-02", "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO")], "2026-11-01", "2026-11-30")))
      .toEqual(["2026-11-02", "2026-11-08", "2026-11-16", "2026-11-22"]);
  });

  it("a timed occurrence that started the evening before still overlaps the range start", () => {
    const e = ev({ id: "o", start: "2026-11-02T23:00:00+09:00", end: "2026-11-03T01:00:00+09:00", recurrence: "FREQ=WEEKLY" });
    expect(starts(expand([e], "2026-11-10", "2026-11-11"))).toEqual(["2026-11-09T23:00:00+09:00"]);
  });

  it("an empty or reversed range gives nothing; exdates on every remaining occurrence end the series", () => {
    const e = allDay("2026-11-02", "FREQ=WEEKLY;COUNT=3", ["2026-11-09", "2026-11-16"]);
    expect(expand([e], "2026-11-10", "2026-11-10")).toEqual([]);
    expect(expand([e], "2026-12-01", "2026-11-01")).toEqual([]);
    expect(hasEnded(e, "2026-11-03")).toBe(true);
    expect(hasEnded(e, "2026-11-02")).toBe(false);
  });

  it("a weekly series from 1926 expands a month view in under 10 ms, on the right Mondays", () => {
    const e = allDay("1926-01-04", "FREQ=WEEKLY"); // a Monday
    expand([e], "2026-10-26", "2026-12-07"); // warm-up
    const t = performance.now();
    const out = expand([e], "2026-10-26", "2026-12-07");
    expect(performance.now() - t).toBeLessThan(10);
    expect(starts(out)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
  });
});

describe("merge and parse with empty or odd input", () => {
  it("merging nothing gives nothing", () => {
    expect(mergeItems()).toEqual([]);
    expect(mergeItems([], [])).toEqual([]);
    expect(parseEvents("[]")).toEqual([]);
    expect(serializeTasks([])).toBe("[]\n");
  });

  it("the newest version wins whatever the list order, duplicates inside one list included", () => {
    const v = (n: number) => task({ id: "a", title: `v${n}`, updatedAt: `2026-11-15T10:00:0${n}.000+09:00` });
    for (const lists of [[[v(1), v(3)], [v(2)]], [[v(3)], [v(2), v(1)]], [[v(2), v(3), v(1)]]])
      expect(mergeItems(...lists).map((t) => t.title)).toEqual(["v3"]);
  });

  it("a tombstone lives exactly 90 days", () => {
    const now = at("2026-11-15T10:00:00+09:00");
    const dead = (ms: number) => task({ id: `d${ms}`, deleted: true, updatedAt: new Date(now.getTime() - 90 * 86400_000 + ms).toISOString() });
    expect(pruneTombstones([dead(0), dead(-1)], now).map((t) => t.id)).toEqual(["d0"]);
  });

  it("holds files that are empty, start with a BOM, or are not an array of objects", () => {
    for (const bad of ["", "﻿[]", "{}", "null", "[null]", "[[]]", '[{"id":"a"}]'])
      expect(() => parseTasks(bad), JSON.stringify(bad)).toThrow();
  });

  it("titles with quotes, newlines and emoji survive a round trip byte for byte", () => {
    const text = serializeEvents([ev({ id: "q", title: '"따옴표"\n줄바꿈 \\ 🙂', notes: "\t" })]);
    expect(serializeEvents(parseEvents(text))).toBe(text);
  });

  it("an edit of an item stamped in the future still wins by 1 ms", () => {
    expect(nextStamp("2030-01-01T00:00:00.000+09:00", at("2026-11-15T10:00:00+09:00"))).toBe("2030-01-01T00:00:00.001+09:00");
  });
});

describe("07:00 pull at boundaries", () => {
  it("a pull at 07:00:00.000 sharp counts for that day; one a millisecond earlier does not", () => {
    const now = at("2026-11-15T07:00:00.001+09:00");
    expect(shouldDailyPull(now, "2026-11-15T07:00:00.000+09:00")).toBe(false);
    expect(shouldDailyPull(now, "2026-11-15T06:59:59.999+09:00")).toBe(true);
  });

  it("works across a year end and with now given in UTC", () => {
    expect(shouldDailyPull(at("2026-12-31T22:00:00Z"), "2026-12-31T07:00:01.000+09:00")).toBe(true); // 2027-01-01 07:00 KST
    expect(shouldDailyPull(at("2026-12-31T21:59:59Z"), "2026-12-31T07:00:01.000+09:00")).toBe(false);
  });
});

describe("upcoming at boundaries", () => {
  it("is empty for no data and uses the Seoul date of now", () => {
    const u = generateUpcoming([], [], at("2026-11-15T15:00:00Z"));
    expect(u).toMatchObject({ from: "2026-11-16", to: "2026-11-30", events: [], tasks: [] });
  });

  it("leaves out an event ending exactly at the start and one starting exactly at the end", () => {
    const u = generateUpcoming([
      ev({ id: "before", start: "2026-11-15T23:00:00+09:00", end: "2026-11-16T00:00:00+09:00" }),
      ev({ id: "after", start: "2026-11-30T00:00:00+09:00", end: "2026-11-30T01:00:00+09:00" }),
      ev({ id: "in", start: "2026-11-29T23:59:00+09:00", end: "2026-11-30T01:00:00+09:00" }),
    ], [], at("2026-11-16T09:00:00+09:00"));
    expect(u.events.map((e) => e.id)).toEqual(["in"]);
  });
});

describe("holidays that hold", () => {
  it("a leap lunar month does not repeat a holiday", () => {
    expect(holidayName("2020-04-30")).toBe("부처님오신날");
    expect(holidayName("2020-05-30")).toBeUndefined(); // leap 4th month, day 8
  });

  it("설날 on a Sunday moves a day off to the first free weekday after the block", () => {
    expect(["2027-02-06", "2027-02-07", "2027-02-08"].map(holidayName)).toEqual(["설날 연휴", "설날", "설날 연휴"]);
    expect(holidayName("2027-02-09")).toBe("대체공휴일(설날)");
  });

  it("Saturday holidays: 어린이날 and 성탄절 get a Monday, 신정 does not", () => {
    expect(holidayName("2029-05-07")).toBe("대체공휴일(어린이날)");
    expect(holidayName("2027-12-27")).toBe("대체공휴일(성탄절)");
    expect(holidayName("2028-01-03")).toBeUndefined();
  });

  it("year ends: Dec 31 is ordinary, Jan 1 is 신정", () => {
    expect(holidayName("2026-12-31")).toBeUndefined();
    expect(holidayName("2027-01-01")).toBe("신정");
  });
});

/** In-memory repo that behaves like the Contents API: PUT with a stale sha is a conflict. Records the PUT order. */
function fakeRemote(files: Record<string, string>) {
  let n = 0;
  let down = false;
  const shas: Record<string, string> = {};
  const puts: string[] = [];
  for (const p of Object.keys(files)) shas[p] = `s${n++}`;
  const guard = () => {
    if (down) throw new Error("network down");
  };
  const remote: Remote = {
    async get(path) {
      guard();
      return path in files ? { text: files[path], sha: shas[path] } : null;
    },
    async list(dir) {
      guard();
      return Object.keys(files)
        .filter((p) => p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/"))
        .map((path) => ({ path, sha: shas[path] }));
    },
    async put(path, text, sha) {
      guard();
      if (shas[path] !== sha) return { kind: "conflict" };
      files[path] = text;
      shas[path] = `s${n++}`;
      puts.push(path);
      return { kind: "ok", sha: shas[path] };
    },
  };
  return {
    remote, files, puts,
    /** A commit made behind the app's back (Pickle). */
    commit(path: string, text: string) {
      files[path] = text;
      shas[path] = `x${n++}`;
    },
    /** A file deleted behind the app's back. */
    remove(path: string) {
      delete files[path];
      delete shas[path];
    },
    setDown: (v: boolean) => (down = v),
  };
}

function memLocal(files: Record<string, string> = {}): Local & { files: Record<string, string> } {
  return {
    files,
    async read(path) {
      return files[path] ?? null;
    },
    async write(path, text) {
      files[path] = text;
    },
    async list(dir) {
      return Object.keys(files).filter((p) => p.startsWith(dir + "/"));
    },
  };
}

const NOW = "2026-11-15T09:00:00+09:00";
const engine = (r: ReturnType<typeof fakeRemote>, local = memLocal(), now = NOW) =>
  createSync({ remote: r.remote, local, now: () => at(now), debounceMs: 3_600_000 });

describe("sync engine paths without a test before this session", () => {
  it("a broken remote file is held: never overwritten, local edits wait, and it merges once repaired", async () => {
    const r = fakeRemote({ "data/tasks.json": "[{ broken" });
    const sync = engine(r);
    await sync.load();
    await sync.syncNow();
    await sync.saveTask(task({ id: "mine" }));
    await sync.push();
    expect(r.files["data/tasks.json"]).toBe("[{ broken");
    expect(sync.status()).toMatchObject({ state: "pending", held: ["data/tasks.json"] });
    expect(sync.tasks().map((t) => t.id)).toEqual(["mine"]);

    r.commit("data/tasks.json", serializeTasks([task({ id: "theirs" })]));
    await sync.syncNow();
    expect(sync.status()).toMatchObject({ state: "merged", held: [] });
    expect(parseTasks(r.files["data/tasks.json"]).map((t) => t.id)).toEqual(["mine", "theirs"]);
  });

  it("an event moved to another month is pushed to the new month before it leaves the old one", async () => {
    const r = fakeRemote({});
    const sync = engine(r);
    await sync.load();
    await sync.saveEvent(ev({ id: "e", start: "2026-11-20T14:00:00+09:00", end: "2026-11-20T15:00:00+09:00" }));
    await sync.syncNow();
    r.puts.length = 0;
    await sync.saveEvent(ev({ id: "e", start: "2026-12-02T14:00:00+09:00", end: "2026-12-02T15:00:00+09:00" }));
    await sync.push();
    expect(r.puts.filter((p) => p.startsWith("data/events/"))).toEqual(["data/events/2026-12.json", "data/events/2026-11.json"]);
    expect(r.files["data/events/2026-11.json"]).toBe("[]\n");
    expect(parseEvents(r.files["data/events/2026-12.json"]).map((e) => e.id)).toEqual(["e"]);
  });

  it("a network failure means offline with the edit kept; the next sync pushes it", async () => {
    const r = fakeRemote({ "data/tasks.json": "[]\n" });
    const local = memLocal();
    const sync = engine(r, local);
    await sync.load();
    await sync.syncNow();
    r.setDown(true);
    await sync.saveTask(task({ id: "a" }));
    await sync.push();
    expect(sync.status()).toMatchObject({ state: "offline", unpushed: 1 });
    expect(parseTasks(local.files["data/tasks.json"]).map((t) => t.id)).toEqual(["a"]);
    expect(JSON.parse(local.files["sync-state.json"]).dirty).toEqual(["data/tasks.json"]);

    r.setDown(false);
    await sync.syncNow();
    expect(sync.status().state).toBe("done");
    expect(parseTasks(r.files["data/tasks.json"]).map((t) => t.id)).toEqual(["a"]);
  });

  it("a restart keeps unpushed edits: a new engine on the same disk pushes them", async () => {
    const r = fakeRemote({ "data/tasks.json": "[]\n" });
    const local = memLocal();
    const first = engine(r, local);
    await first.load();
    await first.syncNow();
    r.setDown(true);
    await first.saveTask(task({ id: "a" }));
    r.setDown(false);

    const second = engine(r, local);
    await second.load();
    expect(second.status().unpushed).toBe(1);
    await second.push();
    expect(parseTasks(r.files["data/tasks.json"]).map((t) => t.id)).toEqual(["a"]);
  });

  it("a remote tombstone deletes the local item only when it is newer", async () => {
    const r = fakeRemote({ "data/tasks.json": "[]\n" });
    const sync = engine(r);
    await sync.load();
    await sync.syncNow();
    await sync.saveTask(task({ id: "old" })); // stamped 09:00
    await sync.saveTask(task({ id: "new" }));
    await sync.push();
    r.commit("data/tasks.json", serializeTasks([
      task({ id: "old", deleted: true, updatedAt: "2026-11-15T09:30:00.000+09:00" }),
      task({ id: "new", deleted: true, updatedAt: "2026-11-15T08:00:00.000+09:00" }),
    ]));
    await sync.syncNow();
    expect(sync.tasks().map((t) => [t.id, t.deleted])).toEqual([["new", false], ["old", true]]);
    expect(parseTasks(r.files["data/tasks.json"]).map((t) => [t.id, t.deleted])).toEqual([["new", false], ["old", true]]);
  });

  it("a tombstone past 90 days is dropped locally and removed from the repo", async () => {
    const r = fakeRemote({
      "data/tasks.json": serializeTasks([task({ id: "gone", deleted: true, updatedAt: "2026-08-01T00:00:00.000+09:00" }), task({ id: "kept" })]),
    });
    const sync = engine(r);
    await sync.load();
    await sync.syncNow();
    expect(sync.tasks().map((t) => t.id)).toEqual(["kept"]);
    expect(parseTasks(r.files["data/tasks.json"]).map((t) => t.id)).toEqual(["kept"]);
  });

  it("a hand-formatted remote file is rewritten in canonical form once, then left alone", async () => {
    const loose = JSON.stringify([{ deleted: false, updatedAt: "2026-11-15T10:00:00.000+09:00", notes: "", status: "todo", title: "t", id: "a" }]);
    const r = fakeRemote({ "data/tasks.json": loose });
    const sync = engine(r);
    await sync.load();
    await sync.syncNow();
    expect(r.files["data/tasks.json"]).toBe(serializeTasks([task({ id: "a" })]));
    r.puts.length = 0;
    await sync.syncNow();
    expect(r.puts).toEqual([]); // the digest differs only by time of day, so it is not pushed again (§2-8)
  });

  it("first connection: local-only data is created in an empty repo, with the guide and the digest", async () => {
    const r = fakeRemote({});
    const sync = engine(r);
    await sync.load();
    await sync.saveTask(task({ id: "t" }));
    await sync.saveEvent(ev({ id: "e" }));
    await sync.syncNow();
    expect(Object.keys(r.files).sort()).toEqual(["AGENT_GUIDE.md", "data/events/2026-11.json", "data/tasks.json", "upcoming.json"]);
    expect(sync.status()).toMatchObject({ state: "done", unpushed: 0 });
  });

  it("the same id in two remote month files ends up only in the month of its newest start", async () => {
    const oldV = ev({ id: "e", updatedAt: "2026-11-15T08:00:00.000+09:00" });
    const newV = ev({ id: "e", start: "2026-12-02T14:00:00+09:00", end: "2026-12-02T15:00:00+09:00", updatedAt: "2026-11-15T08:30:00.000+09:00" });
    const r = fakeRemote({ "data/events/2026-11.json": serializeEvents([oldV]), "data/events/2026-12.json": serializeEvents([newV]) });
    const sync = engine(r);
    await sync.load();
    await sync.syncNow();
    expect(sync.events()).toEqual([newV]);
    expect(r.files["data/events/2026-11.json"]).toBe("[]\n");
    expect(r.files["data/events/2026-12.json"]).toBe(serializeEvents([newV]));
  });

  it("a month file deleted in the repo comes back on the next sync (the app never drops items without a tombstone)", async () => {
    const r = fakeRemote({});
    const sync = engine(r);
    await sync.load();
    await sync.saveEvent(ev({ id: "e" }));
    await sync.syncNow();
    r.remove("data/events/2026-11.json");
    await sync.syncNow();
    expect(parseEvents(r.files["data/events/2026-11.json"]).map((e) => e.id)).toEqual(["e"]);
  });

  it("a received stamp more than 10 minutes ahead raises the clock warning; 9 minutes does not", async () => {
    for (const [stamp, skew] of [["2026-11-15T09:10:00.001+09:00", true], ["2026-11-15T09:09:00.000+09:00", false]] as const) {
      const r = fakeRemote({ "data/tasks.json": serializeTasks([task({ id: "a", updatedAt: stamp })]) });
      const sync = engine(r);
      await sync.load();
      await sync.syncNow();
      expect(sync.status().clockSkew).toBe(skew);
    }
  });
});
