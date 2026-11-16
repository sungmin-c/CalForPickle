import { describe, expect, it } from "vitest";
import { parseTasks, serializeTasks } from "../src/model";
import { createSync, shouldDailyPull, type Local, type Remote } from "../src/sync";
import { ev, task } from "./fixtures";

const at = (s: string) => new Date(s);

describe("8. daily 07:00 pull condition", () => {
  const yesterday7 = "2026-11-14T07:00:10.000+09:00";
  it("fires exactly at 07:00", () => {
    expect(shouldDailyPull(at("2026-11-15T07:00:00+09:00"), yesterday7)).toBe(true);
  });
  it("does not fire at 06:59 when yesterday was pulled", () => {
    expect(shouldDailyPull(at("2026-11-15T06:59:59+09:00"), yesterday7)).toBe(false);
  });
  it("fires after sleep resume or late boot", () => {
    expect(shouldDailyPull(at("2026-11-15T13:20:00+09:00"), yesterday7)).toBe(true);
  });
  it("catches up before 07:00 if yesterday's 07:00 was missed", () => {
    expect(shouldDailyPull(at("2026-11-15T06:00:00+09:00"), "2026-11-13T08:00:00.000+09:00")).toBe(true);
  });
  it("does not fire again on a day already pulled", () => {
    expect(shouldDailyPull(at("2026-11-15T23:59:00+09:00"), "2026-11-15T07:00:01.000+09:00")).toBe(false);
  });
  it("fires on first run", () => {
    expect(shouldDailyPull(at("2026-11-15T03:00:00+09:00"), undefined)).toBe(true);
  });
});

/** In-memory repo that behaves like Contents API: PUT with a stale sha is a conflict. */
function fakeRemote(files: Record<string, string>) {
  let n = 0;
  const shas: Record<string, string> = {};
  for (const p of Object.keys(files)) shas[p] = `s${n++}`;
  const remote: Remote = {
    async get(path) {
      return path in files ? { text: files[path], sha: shas[path] } : null;
    },
    async list(dir) {
      return Object.keys(files)
        .filter((p) => p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/"))
        .map((path) => ({ path, sha: shas[path] }));
    },
    async put(path, text, sha) {
      if (shas[path] !== sha) return { kind: "conflict" };
      files[path] = text;
      shas[path] = `s${n++}`;
      return { kind: "ok", sha: shas[path] };
    },
  };
  return { remote, files, shas };
}

function memLocal(files: Record<string, string> = {}): Local {
  return {
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

describe("5. app edit right after a Pickle push", () => {
  it("409 -> refetch, merge by id, re-put: both items survive", async () => {
    const r = fakeRemote({ "data/tasks.json": "[]\n" });
    const sync = createSync({ remote: r.remote, local: memLocal(), now: () => at("2026-11-15T09:00:00+09:00") });
    await sync.load();
    await sync.syncNow();
    expect(sync.status().state).toBe("done");
    expect(r.files["AGENT_GUIDE.md"]).toMatch(/^<!-- agent-guide v4 -->/);

    // Pickle commits a new task directly to the repo.
    const pickle = task({ id: "p", title: "from pickle", updatedAt: "2026-11-15T09:30:00.000+09:00" });
    r.files["data/tasks.json"] = serializeTasks([pickle]);
    r.shas["data/tasks.json"] = "pickle-sha";

    // The app, unaware, edits its own task and pushes with the stale sha.
    await sync.saveTask(task({ id: "m", title: "from me" }));
    await sync.push();

    const ids = parseTasks(r.files["data/tasks.json"]).map((t) => t.id);
    expect(ids).toEqual(["m", "p"]);
    expect(sync.tasks().map((t) => t.id)).toEqual(["m", "p"]);
    expect(sync.status().state).toBe("merged");
    expect(r.files["upcoming.json"]).toContain('"from pickle"');
  });
});

describe("unpushed count while not connected (session 12)", () => {
  it("counts files waiting for the first push, not edits", async () => {
    const down = () => Promise.reject(new Error("not connected"));
    const remote: Remote = { get: down, list: down, put: down };
    const sync = createSync({ remote, local: memLocal(), now: () => at("2026-11-15T09:00:00+09:00") });
    await sync.load();
    const base = sync.status().unpushed;
    await sync.saveTask(task({ id: "a" }));
    const one = sync.status().unpushed;
    expect(one).toBeGreaterThan(base);
    await sync.saveTask(task({ id: "b" })); // same tasks.json
    expect(sync.status().unpushed).toBe(one);
    await sync.saveEvent(ev({ id: "e1" }));
    await sync.saveEvent(ev({ id: "e2" })); // same month file
    expect(sync.status().unpushed).toBe(one + 1);
  });
});
