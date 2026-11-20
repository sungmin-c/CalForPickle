import { describe, expect, it } from "vitest";
import { parseTasks, serializeEvents, serializeTasks } from "../src/model";
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
    expect(r.files["AGENT_GUIDE.md"]).toMatch(/^<!-- agent-guide v7 -->/);
    expect(r.files["AGENT_GUIDE.md"]).toContain("generatedAt");

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

describe("gh_* path allow-list (handoff §2-4)", () => {
  it("pull never asks for repo files outside the allow-list, so a stray file cannot break sync", async () => {
    const r = fakeRemote({
      "data/tasks.json": "[]\n",
      "data/events/2026-11.json": serializeEvents([ev({ id: "e1", start: "2026-11-15T10:00:00+09:00" })]),
      "data/events/memo.json": "[]\n",
      "data/events/2026-11.json.bak.json": "[]\n",
      "data/notes.json": "[]\n",
    });
    const asked: string[] = [];
    const get = r.remote.get;
    r.remote.get = async (path) => {
      asked.push(path);
      return get(path);
    };
    const sync = createSync({ remote: r.remote, local: memLocal(), now: () => at("2026-11-15T09:00:00+09:00") });
    await sync.load();
    await sync.syncNow();
    expect(sync.status().state).not.toBe("error");
    expect(asked.filter((p) => !/^(data\/tasks\.json|data\/events\/\d{4}-\d\d\.json|AGENT_GUIDE\.md)$/.test(p))).toEqual([]);
  });
});

describe("saves no longer wait for the network queue (handoff §1-A)", () => {
  it("an edit saved while its file is being pushed stays dirty and goes out next", async () => {
    const r = fakeRemote({ "data/tasks.json": "[]\n" });
    let release = () => {};
    const put = r.remote.put;
    r.remote.put = async (...args) => {
      if (args[0] === "data/tasks.json") await new Promise<void>((ok) => (release = ok));
      return put(...args);
    };
    const sync = createSync({ remote: r.remote, local: memLocal(), now: () => at("2026-11-15T09:00:00+09:00"), debounceMs: 3_600_000 });
    await sync.load();
    await sync.syncNow(); // learn the sha; tasks.json is not dirty, so no gated put
    await sync.saveTask(task({ id: "a" }));
    const pushing = sync.push(); // sends "a" only, then waits in put
    await new Promise((ok) => setTimeout(ok, 10));
    await sync.saveTask(task({ id: "b" }));
    release();
    await pushing;
    expect(parseTasks(r.files["data/tasks.json"]).map((t) => t.id)).toEqual(["a"]);
    expect(sync.status().unpushed).toBe(1);
    const second = sync.push();
    await new Promise((ok) => setTimeout(ok, 10));
    release();
    await second;
    expect(parseTasks(r.files["data/tasks.json"]).map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("unpushed count while not connected", () => {
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

describe("private re-check on pull (handoff §2-5)", () => {
  const setup = (isPrivate: () => Promise<boolean>) => {
    const r = fakeRemote({ "data/tasks.json": "[]\n" });
    const puts: string[] = [];
    const put = r.remote.put;
    r.remote.put = async (...a) => (puts.push(a[0]), put(...a));
    r.remote.isPrivate = isPrivate;
    const sync = createSync({ remote: r.remote, local: memLocal(), now: () => at("2026-11-15T09:00:00+09:00"), debounceMs: 3_600_000 });
    return { sync, puts };
  };

  it("repo turned public: pull flags it and nothing is pushed", async () => {
    const { sync, puts } = setup(async () => false);
    await sync.load();
    await sync.saveTask(task({ id: "a" }));
    await sync.syncNow();
    await sync.push();
    expect(sync.status().publicRepo).toBe(true);
    expect(puts).toEqual([]);
    expect(sync.status().unpushed).toBeGreaterThan(0);
  });

  it("repo private again: next pull clears the flag and pushes the waiting edit", async () => {
    let priv = false;
    const { sync, puts } = setup(async () => priv);
    await sync.load();
    await sync.saveTask(task({ id: "a" }));
    await sync.syncNow();
    expect(sync.status().publicRepo).toBe(true);
    priv = true;
    await sync.syncNow();
    expect(sync.status().publicRepo).toBe(false);
    expect(puts).toContain("data/tasks.json");
  });

  it("private repo: sync works as before", async () => {
    const { sync, puts } = setup(async () => true);
    await sync.load();
    await sync.saveTask(task({ id: "a" }));
    await sync.syncNow();
    expect(sync.status().publicRepo).toBe(false);
    expect(puts).toContain("data/tasks.json");
  });

  it("check fails (offline): counts as offline, not as public", async () => {
    const { sync } = setup(() => Promise.reject(new Error("net")));
    await sync.load();
    await sync.syncNow();
    expect(sync.status().state).toBe("offline");
    expect(sync.status().publicRepo).toBe(false);
  });
});

describe("upcoming.json duplicate PUT (handoff §2-8)", () => {
  const run = async (times: string[]) => {
    const r = fakeRemote({ "data/tasks.json": "[]\n" });
    const puts: string[] = [];
    const put = r.remote.put;
    r.remote.put = async (...a) => (puts.push(a[0]), put(...a));
    let i = 0;
    const sync = createSync({ remote: r.remote, local: memLocal(), now: () => at(times[Math.min(i, times.length - 1)]), debounceMs: 3_600_000 });
    await sync.load();
    for (; i < times.length; i++) await sync.syncNow();
    return puts.filter((p) => p === "upcoming.json").length;
  };

  it("same content, same day: only the first sync writes it", async () => {
    expect(await run(["2026-11-15T09:00:00+09:00", "2026-11-15T09:05:00+09:00", "2026-11-15T20:00:00+09:00"])).toBe(1);
  });
  it("a new day writes it again even if nothing else changed (generatedAt must be today)", async () => {
    expect(await run(["2026-11-15T09:00:00+09:00", "2026-11-16T07:00:00+09:00"])).toBe(2);
  });
});
