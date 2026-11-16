import { invoke } from "@tauri-apps/api/core";
import { AGENT_GUIDE, GUIDE_PATH, needsGuide } from "./agentGuide";
import { mergeItems, pruneTombstones } from "./merge";
import {
  instant,
  nextStamp,
  parseEvents,
  parseTasks,
  seoulDate,
  seoulStamp,
  serializeEvents,
  serializeTasks,
  type Event,
  type Item,
  type Task,
} from "./model";
import { EVENTS_DIR, eventPath, partition } from "./partition";
import { generateUpcoming, serializeUpcoming, UPCOMING_PATH } from "./upcoming";

export type PutResult = { kind: "ok"; sha: string } | { kind: "conflict" };

/** GitHub Contents API, reached through Rust so the PAT never enters the webview. Network errors reject. */
export interface Remote {
  get(path: string): Promise<{ text: string; sha: string } | null>;
  /** Files (not subdirectories) directly under dir; [] when dir does not exist. */
  list(dir: string): Promise<{ path: string; sha: string }[]>;
  put(path: string, text: string, sha: string | undefined): Promise<PutResult>;
}

/** %APPDATA%\CalForPickle, paths relative to it. */
export interface Local {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  list(dir: string): Promise<string[]>;
}

export type SyncState = "done" | "pending" | "offline" | "merged";
export interface SyncStatus {
  state: SyncState;
  /** Remote files left untouched because they failed to parse (§7.2 #6). */
  held: string[];
  /** A received updatedAt was more than 10 minutes in the future (§7.1 #2). */
  clockSkew: boolean;
  /** Files (month files, tasks.json) waiting to be pushed, not edits: ten edits in one month count once. */
  unpushed: number;
  error?: string;
}

interface Persisted {
  files: Record<string, string>;
  dirty: string[];
  lastPullAt?: string;
}

const STATE_PATH = "sync-state.json";
export const TASKS_PATH = "data/tasks.json";
const EMPTY = "[]\n";
const DAY_MS = 86400_000;
const SKEW_MS = 10 * 60_000;
const MAX_RETRIES = 3;

/** True when the most recent 07:00 Seoul has passed since the last pull. Covers on-time, wake from sleep, late boot. */
export function shouldDailyPull(now: Date, lastPullAt: string | undefined): boolean {
  const today7 = instant(seoulDate(now.getTime())) + 7 * 3600_000;
  const last7 = now.getTime() >= today7 ? today7 : today7 - DAY_MS;
  return !lastPullAt || Date.parse(lastPullAt) < last7;
}

const isData = (p: string) => p === TASKS_PATH || p.startsWith(EVENTS_DIR + "/");

export function createSync(opts: {
  remote: Remote;
  local: Local;
  now?: () => Date;
  debounceMs?: number;
  onChange?: () => void;
}) {
  const { remote, local, now = () => new Date(), debounceMs = 15_000, onChange = () => {} } = opts;
  let events: Event[] = [];
  let tasks: Task[] = [];
  let st: Persisted = { files: {}, dirty: [] };
  let merged = false;
  let offline = false;
  let clockSkew = false;
  let error: string | undefined;
  let upcomingDue = false;
  const held = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Every disk/network step runs through this queue so a push never interleaves with a save or a pull.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  /** Moves paths to the end of the push order, keeping their relative order. */
  const markDirty = (paths: string[]) => {
    st.dirty = [...st.dirty.filter((p) => !paths.includes(p)), ...paths];
  };

  const byPath = (): Map<string, Item[]> => {
    const m = new Map<string, Item[]>(partition(events));
    m.set(TASKS_PATH, tasks);
    return m;
  };

  const textFor = (path: string, items: Item[] | undefined) =>
    path === TASKS_PATH ? serializeTasks((items ?? []) as Task[]) : serializeEvents((items ?? []) as Event[]);

  const persist = () => local.write(STATE_PATH, JSON.stringify(st, null, 2) + "\n");

  /** Merge fetched remote files into state, rewrite affected local files, and recompute dirty for each. */
  async function absorb(fetched: { path: string; text: string; sha: string }[]) {
    const incoming: { events: Event[]; tasks: Task[] } = { events: [], tasks: [] };
    const remoteCount = new Map<string, number>();
    const ok = new Map<string, string>();
    for (const f of fetched) {
      try {
        const items = f.path === TASKS_PATH ? parseTasks(f.text) : parseEvents(f.text);
        if (f.path === TASKS_PATH) incoming.tasks.push(...(items as Task[]));
        else incoming.events.push(...(items as Event[]));
        remoteCount.set(f.path, items.length);
        ok.set(f.path, f.text);
        held.delete(f.path);
        st.files[f.path] = f.sha;
      } catch (e) {
        held.add(f.path);
        error = `${f.path}: ${(e as Error).message}`;
      }
    }
    const limit = now().getTime() + SKEW_MS;
    if ([...incoming.events, ...incoming.tasks].some((i) => Date.parse(i.updatedAt) > limit)) clockSkew = true;

    const before = byPath();
    events = pruneTombstones(mergeItems(events, incoming.events), now());
    tasks = pruneTombstones(mergeItems(tasks, incoming.tasks), now());
    const after = byPath();

    const newlyDirty: { path: string; gain: number }[] = [];
    for (const path of new Set([...before.keys(), ...after.keys(), ...ok.keys()])) {
      const text = textFor(path, after.get(path));
      const localChanged = text !== textFor(path, before.get(path));
      if (localChanged) {
        merged = true;
        await local.write(path, text);
      }
      const remoteText = ok.get(path);
      if (remoteText === undefined ? localChanged : text !== remoteText) {
        const base = remoteCount.get(path) ?? before.get(path)?.length ?? 0;
        newlyDirty.push({ path, gain: (after.get(path)?.length ?? 0) - base });
      } else if (remoteText !== undefined) {
        st.dirty = st.dirty.filter((p) => p !== path);
      }
    }
    // Files gaining items go first, so a month move never leaves the item missing remotely (§7.1 #3).
    markDirty(newlyDirty.sort((a, b) => b.gain - a.gain).map((d) => d.path));
  }

  async function pullNow() {
    clockSkew = false;
    const listing = [...(await remote.list("data")), ...(await remote.list(EVENTS_DIR))].filter((f) =>
      isData(f.path) && f.path.endsWith(".json"),
    );
    const fetched = [];
    for (const f of listing) {
      if (st.files[f.path] === f.sha) continue;
      const got = await remote.get(f.path);
      if (got) fetched.push({ path: f.path, ...got });
    }
    await absorb(fetched);

    // Local data files missing remotely (first connection, or deleted upstream) are created on push.
    const remotePaths = new Set(listing.map((f) => f.path));
    const missing = [...byPath().keys()].filter((p) => !remotePaths.has(p));
    for (const p of missing) {
      delete st.files[p];
      await local.write(p, textFor(p, byPath().get(p)));
    }
    markDirty(missing.filter((p) => !st.dirty.includes(p)));

    const guide = await remote.get(GUIDE_PATH);
    if (guide) st.files[GUIDE_PATH] = guide.sha;
    if (needsGuide(guide?.text)) {
      await local.write(GUIDE_PATH, AGENT_GUIDE);
      markDirty([GUIDE_PATH]);
    }
    st.lastPullAt = seoulStamp(now().getTime());
    upcomingDue = true;
  }

  /** PUT with the known sha; on conflict refresh (merging data files) and retry. */
  async function putPath(path: string, text: () => Promise<string>): Promise<boolean> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const r = await remote.put(path, await text(), st.files[path]);
      if (r.kind === "ok") {
        st.files[path] = r.sha;
        return true;
      }
      const got = await remote.get(path);
      if (!got) delete st.files[path];
      else if (isData(path)) {
        await absorb([{ path, ...got }]);
        if (held.has(path)) return false;
        if (!st.dirty.includes(path)) return true; // remote already holds our content
      } else st.files[path] = got.sha; // guide/upcoming: ours replaces theirs
    }
    return false;
  }

  async function pushNow() {
    clearTimeout(timer);
    const tried = new Set<string>();
    let pushed = false;
    for (let path; (path = st.dirty.find((p) => !tried.has(p) && !held.has(p))); ) {
      tried.add(path);
      const p = path;
      if (await putPath(p, async () => (await local.read(p)) ?? EMPTY)) {
        st.dirty = st.dirty.filter((d) => d !== p);
        pushed = true;
      }
    }
    if (pushed || upcomingDue) {
      const text = serializeUpcoming(generateUpcoming(events, tasks, now()));
      await local.write(UPCOMING_PATH, text);
      if (await putPath(UPCOMING_PATH, async () => text)) upcomingDue = false;
    }
  }

  /** Runs a network step; any rejection means offline, dirty is kept for the next try. */
  const net = (fn: () => Promise<void>) =>
    enqueue(async () => {
      try {
        await fn();
        offline = false;
        if (!held.size) error = undefined;
      } catch (e) {
        offline = true;
        error = String(e);
      } finally {
        await persist();
        onChange();
      }
    });

  async function save(paths: string[]) {
    merged = false;
    onChange();
    await enqueue(async () => {
      const m = byPath();
      for (const p of paths) await local.write(p, textFor(p, m.get(p)));
      markDirty(paths);
      await persist();
    });
    clearTimeout(timer);
    timer = setTimeout(() => void push(), debounceMs);
  }

  const pull = () => net(pullNow);
  const push = () => net(pushNow);
  const syncNow = () => net(async () => (await pullNow(), await pushNow()));

  return {
    async load() {
      const s = await local.read(STATE_PATH);
      if (s) st = JSON.parse(s);
      const all: Event[] = [];
      const paths = (await local.list(EVENTS_DIR)).filter((p) => p.endsWith(".json")); // skip leftover .tmp
      for (const p of paths) all.push(...parseEvents((await local.read(p)) ?? EMPTY));
      events = mergeItems(all);
      tasks = parseTasks((await local.read(TASKS_PATH)) ?? EMPTY);
    },
    events: () => events,
    tasks: () => tasks,
    status(): SyncStatus {
      const state: SyncState = offline
        ? "offline"
        : st.dirty.length || held.size
          ? "pending"
          : merged
            ? "merged"
            : "done";
      return { state, held: [...held], clockSkew, unpushed: st.dirty.length, error };
    },
    /** Create, edit or soft-delete (deleted: true) an event. Memory updates now; push follows the debounce. */
    saveEvent(e: Event) {
      const prev = events.find((x) => x.id === e.id);
      const next = { ...e, updatedAt: nextStamp(prev?.updatedAt, now()) };
      events = mergeItems(events.filter((x) => x.id !== e.id), [next]);
      const paths = [eventPath(next)];
      if (prev && eventPath(prev) !== paths[0]) paths.push(eventPath(prev)); // new month first, old after
      return save(paths);
    },
    saveTask(t: Task) {
      const prev = tasks.find((x) => x.id === t.id);
      const next = { ...t, updatedAt: nextStamp(prev?.updatedAt, now()) };
      tasks = mergeItems(tasks.filter((x) => x.id !== t.id), [next]);
      return save([TASKS_PATH]);
    },
    pull,
    push,
    syncNow,
    /** Checks the 07:00 condition every minute. Returns a stop function. */
    start() {
      const tick = () => {
        if (shouldDailyPull(now(), st.lastPullAt)) void syncNow();
      };
      tick();
      const id = setInterval(tick, 60_000);
      return () => clearInterval(id);
    },
    /** On app exit: push pending edits, waiting at most 10s. Unpushed files stay dirty for next launch. */
    flush: () => Promise.race([push(), new Promise((r) => setTimeout(r, 10_000))]),
  };
}

export function tauriRemote(owner: string, repo: string): Remote {
  return {
    get: (path) => invoke("gh_get", { owner, repo, path }),
    list: (path) => invoke("gh_list", { owner, repo, path }),
    put: (path, text, sha) => invoke("gh_put", { owner, repo, path, text, sha: sha ?? null }),
  };
}

export const tauriLocal: Local = {
  read: (path) => invoke("local_read", { path }),
  write: (path, text) => invoke("local_write", { path, text }),
  list: (path) => invoke("local_list", { path }),
};
