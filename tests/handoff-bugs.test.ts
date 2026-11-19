// Inputs that break today (handoff session, 2026-11-17). Every test here states the wanted behaviour and FAILS until src/ is fixed.
// Details, fix plans and priorities: docs/fable-handoff.md §1. Do not weaken a test to make it pass; fix src/ instead.
import { afterEach, describe, expect, it, vi } from "vitest";
import { holidayName } from "../src/holidays";
import { instant, parseEvents, parseTasks, serializeEvents } from "../src/model";
import { describeRule, expand, parseRule } from "../src/recur";
import { createSync, type Local, type Remote } from "../src/sync";
import { fromForm, toForm } from "../src/ui/dates";
import { ev, task } from "./fixtures";

const at = (s: string) => new Date(s);

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

describe("H1. lunar holidays use the Chinese calendar, which differs from the Korean one on some days", () => {
  it("설날 2028 is Jan 27 (Chinese New Year is Jan 26)", () => {
    expect(["2028-01-26", "2028-01-27", "2028-01-28"].map(holidayName)).toEqual(["설날 연휴", "설날", "설날 연휴"]);
  });
  it("설날 2030 is Feb 3", () => {
    expect(holidayName("2030-02-03")).toBe("설날");
  });
  it("추석 2040 is Sep 21", () => {
    expect(holidayName("2040-09-21")).toBe("추석");
  });
  it("부처님오신날 2023 was May 27 (a Saturday), with a day off on May 29", () => {
    expect(holidayName("2023-05-27")).toBe("부처님오신날");
    expect(holidayName("2023-05-29")).toBe("대체공휴일(부처님오신날)");
  });
});

describe("H2. a holiday that lands on another holiday gets no substitute day", () => {
  it("2025-05-05 was 어린이날 and 부처님오신날: May 6 was a day off", () => {
    expect(holidayName("2025-05-06")).toMatch(/^대체공휴일/);
  });
  it("2028-10-03 is 개천절 inside the 추석 block: Oct 5 is a day off", () => {
    expect(holidayName("2028-10-05")).toMatch(/^대체공휴일/);
  });
});

describe("H3. an item that passes the parser but crashes the calendar", () => {
  const poison = ev({ id: "p", allDay: true, recurrence: "FREQ=DAILY" }); // allDay with timed start/end (fixture default)

  it("allDay + recurrence + a timed start is held at parse time", () => {
    expect(() => parseEvents(serializeEvents([poison]))).toThrow();
  });
  it("or at least does not throw while expanding", () => {
    expect(() => expand([poison], "2026-11-01", "2026-12-01")).not.toThrow();
  });
});

describe("H4. recurrence rules the parser lets through", () => {
  it("UNTIL with an impossible date-time is rejected (it becomes NaN: the series never ends and the routine list crashes)", () => {
    expect(() => parseRule("FREQ=WEEKLY;UNTIL=20261340T000000Z")).toThrow();
  });
  it("describing any rule the parser accepted never throws", () => {
    const text = "FREQ=WEEKLY;UNTIL=20261340T000000Z";
    let parsed = true;
    try {
      parseRule(text);
    } catch {
      parsed = false;
    }
    if (parsed) expect(() => describeRule(text, "2026-11-03")).not.toThrow();
  });
  it("FREQ must be one of the four names, not any Object.prototype key", () => {
    for (const bad of ["FREQ=toString", "FREQ=constructor", "FREQ=__proto__"]) expect(() => parseRule(bad), bad).toThrow();
  });
});

describe("H5. a task whose due is not a calendar date shows nowhere in the app", () => {
  // The day cell wants due === "YYYY-MM-DD" (dayList.ts) and the side panel only lists tasks without due (Tasks.tsx).
  it("holds the file on a due that is not YYYY-MM-DD", () => {
    for (const due of ["2026-11-20T10:00:00+09:00", "내일", "2026-11-2", "2026-02-30"])
      expect(() => parseTasks(JSON.stringify([{ ...task({ id: "a" }), due }])), due).toThrow();
  });
});

describe("H6. the event form with a cleared date", () => {
  it("returns the error message instead of throwing", () => {
    const f = toForm(ev({ id: "a", start: "2026-11-20", end: "2026-11-21", allDay: true }));
    expect(fromForm({ ...f, endDate: "" }, ev({ id: "a" }))).toBe("날짜와 시간을 모두 입력하세요.");
  });
});

describe("H7. a start/end without an offset means Seoul time on any PC", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("reads 14:00 as 14:00 KST when the PC is set to New York", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(instant("2026-11-20T14:00:00")).toBe(Date.parse("2026-11-20T14:00:00+09:00"));
  });
});

describe("H8. the sync queue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes an edit to disk while a network request hangs", async () => {
    const never = new Promise<never>(() => {});
    const remote: Remote = { get: () => never, list: () => never, put: () => never };
    const local = memLocal();
    const sync = createSync({ remote, local, now: () => at("2026-11-15T09:00:00+09:00"), debounceMs: 3_600_000 });
    await sync.load();
    void sync.pull(); // hangs: reqwest has no timeout (src-tauri/src/github.rs)
    void sync.saveTask(task({ id: "a" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(local.files["data/tasks.json"] ?? "(not written)").toContain('"id": "a"');
  });

  it("retries a failed push by itself, without waiting for the next edit or 07:00", async () => {
    vi.useFakeTimers({ now: at("2026-11-15T09:00:00+09:00") });
    let down = false;
    const files: Record<string, string> = {};
    const remote: Remote = {
      async get(path) {
        if (down) throw new Error("down");
        return path in files ? { text: files[path], sha: files[path] } : null;
      },
      async list() {
        if (down) throw new Error("down");
        return [];
      },
      async put(path, text) {
        if (down) throw new Error("down");
        files[path] = text;
        return { kind: "ok", sha: text };
      },
    };
    const sync = createSync({ remote, local: memLocal(), debounceMs: 15_000 });
    await sync.load();
    const stop = sync.start(); // today's pull succeeds
    await vi.advanceTimersByTimeAsync(1_000);
    down = true;
    await sync.saveTask(task({ id: "a" }));
    await vi.advanceTimersByTimeAsync(20_000); // debounce fires, push fails
    expect(sync.status().state).toBe("offline");
    down = false;
    await vi.advanceTimersByTimeAsync(10 * 60_000); // ten minutes back online, no new edit
    stop();
    expect(files["data/tasks.json"] ?? "(never pushed)").toContain('"id": "a"');
  });

  it("a broken local file does not stop the app from starting", async () => {
    const local = memLocal({ "data/events/2026-11.json": "[{ broken", "data/tasks.json": "[]\n" });
    const remote: Remote = { get: async () => null, list: async () => [], put: async () => ({ kind: "conflict" }) };
    const sync = createSync({ remote, local });
    await expect(sync.load()).resolves.toBeUndefined();
  });
});
