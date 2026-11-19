import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { setLang, tr, type Lang } from "../i18n";
import type { Event, Task } from "../model";
import { createSync, tauriLocal, tauriRemote, type Remote, type SyncState } from "../sync";
import { Calendar, calendarTitle, shift, type View } from "./Calendar";
import { routineList } from "../recur";
import { today } from "./dates";
import { EventDialog, newEvent, TaskDialog } from "./Dialogs";
import { Check, Clock, Close, Merge, Next, Offline, Prev, Gear, Menu, Pin, Warn } from "./icons";
import { fitsOnScreen, insideOneScreen, normalizeSettings, type Settings } from "./prefs";
import { SettingsDialog } from "./Settings";
import { TaskPanel } from "./Tasks";

type Sync = ReturnType<typeof createSync>;
interface Engine {
  sync: Sync;
  stop: () => void;
  live: boolean;
  hasToken: boolean;
}

const SETTINGS_PATH = "settings.json";
const notConnected = () => Promise.reject(new Error("GitHub 연결 안 됨"));
// Without a connection the engine still saves locally and keeps files dirty for the first real push.
const noRemote: Remote = { get: notConnected, list: notConnected, put: notConnected };

async function boot(s: Settings, onChange: () => void): Promise<Engine> {
  const hasToken = await invoke<boolean>("secret_exists").catch(() => false);
  const live = !!(s.owner && s.repo && hasToken);
  const sync = createSync({ remote: live ? tauriRemote(s.owner!, s.repo!) : noRemote, local: tauriLocal, onChange });
  await sync.load();
  return { sync, live, hasToken, stop: live ? sync.start() : () => {} };
}

/** The window starts hidden (tauri.conf.json) so it never flashes at the default spot before this runs. */
async function restoreWindow(s: Settings) {
  const w = getCurrentWindow();
  if (s.window) {
    const screens = (await availableMonitors()).map(({ workArea: { position: p, size: z } }) =>
      ({ x: p.x, y: p.y, width: z.width, height: z.height }));
    if (fitsOnScreen(s.window, screens)) {
      await w.setPosition(new PhysicalPosition(s.window.x, s.window.y));
      await w.setSize(new PhysicalSize(s.window.width, s.window.height));
    }
  }
}

/** Pinned: on the desktop under the icons, fixed in place, clicked through wherever no icon covers it (desktop.rs, session 22).
 *  Unpinned: an ordinary window for moving and resizing only.
 *  Resizable changes go while the window is top-level: tao rewrites the window style on every flag change. */
async function applyPin(on: boolean) {
  const w = getCurrentWindow();
  if (on) await w.setResizable(false);
  await invoke("desktop_pin", { on });
  if (!on) await w.setResizable(true);
}

/** The whole window must sit on one monitor to be pinned. */
async function canPin() {
  const w = getCurrentWindow();
  const [p, z, ms] = await Promise.all([w.outerPosition(), w.outerSize(), availableMonitors()]);
  return insideOneScreen({ x: p.x, y: p.y, width: z.width, height: z.height },
    ms.map(({ position: q, size: m }) => ({ x: q.x, y: q.y, width: m.width, height: m.height })));
}


async function applyAutostart(on: boolean) {
  if (!import.meta.env.PROD) return; // a dev run would register the target\debug exe in the Run key
  if ((await isEnabled()) !== on) await (on ? enable() : disable());
}

const ICON: Record<SyncState, () => preact.JSX.Element> = { done: Check, pending: Clock, offline: Offline, merged: Merge };

/** Screen text, <html lang> and the tray menu (Rust keeps Korean until the page calls this). */
function applyLang(l: Lang) {
  setLang(l);
  invoke("set_tray_labels", { open: tr.trayOpen, quit: tr.trayQuit }).catch(console.error);
}

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const ref = useRef<Engine | null>(null);
  const [settings, setSettings] = useState<Settings>(() => normalizeSettings(null));
  const prefs = useRef(settings); // latest saved settings, for writes from event listeners
  const [offScreen, setOffScreen] = useState(false); // the last pin attempt was refused
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const [view, setView] = useState<View>("month");
  const [sel, setSel] = useState(today());
  const [editEvent, setEditEvent] = useState<{ event: Event; isNew: boolean; day?: string } | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [cellEdit, setCellEdit] = useState(false);
  // Under the icons the page gets no mouse moves and an icon can cover a dialog: while one is open, sit above them (desktop.rs).
  const editing = !!(editEvent || editTask || showSettings || cellEdit);
  useEffect(() => void invoke("desktop_raise", { on: editing }).catch(() => {}), [editing, settings.alwaysBottom]);
  const [syncing, setSyncing] = useState(false);
  const [fatal, setFatal] = useState("");

  /** Swap engines: flush the old one (push what it can), run `between`, then load a fresh one from disk. */
  async function reconnect(s: Settings, between?: () => Promise<unknown>) {
    const cur = ref.current;
    if (cur) {
      await cur.sync.flush();
      cur.stop();
    }
    await between?.();
    const next = await boot(s, bump);
    ref.current = next;
    setEngine(next);
  }

  useEffect(() => {
    const win = getCurrentWindow();
    const geometry = async () => {
      const [p, z] = await Promise.all([win.outerPosition(), win.innerSize()]);
      return { x: p.x, y: p.y, width: z.width, height: z.height };
    };
    // Showing the window fires a move event too; only a geometry different from startup is a user change worth writing.
    let last = "";
    (async () => {
      const s = normalizeSettings(await tauriLocal.read(SETTINGS_PATH));
      applyLang(s.lang);
      prefs.current = s;
      setSettings(s);
      await restoreWindow(s).catch(console.error);
      await win.show(); // before pinning: showing rewrites the window style (desktop.rs)
      last = JSON.stringify(await geometry());
      if (s.alwaysBottom) {
        if (await canPin()) await applyPin(true);
        else {
          setOffScreen(true); // e.g. a monitor came off since last time
          await saveSettings({ alwaysBottom: false });
        }
      }
      applyAutostart(s.autostart).catch(console.error);
      await reconnect(s);
    })().catch((e) => {
      setFatal(String(e));
      void win.show();
    });
    const unlisten = listen("quit-requested", async () => {
      await ref.current?.sync.flush(); // resolves within 10 s
      await invoke("app_exit");
    });
    // Save position and size 0.5 s after moving or resizing stops. Minimized/maximized geometry is not a place to come back to.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onGeometry = () => {
      // Pinned, the window is a child of the desktop and its rect reads back scaled (session 21): never save it.
      // Before startup finishes, prefs still hold the defaults (unpinned): a recreated window saved its child rect that way.
      if (prefs.current.alwaysBottom || !last) return;
      setOffScreen(false);
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if ((await win.isMinimized()) || (await win.isMaximized())) return;
        const g = await geometry();
        if (JSON.stringify(g) === last) return;
        last = JSON.stringify(g);
        await saveSettings({ window: g });
      }, 500);
    };
    // Pinned, the window sits under the desktop icons and gets no mouse input; desktop.rs passes on left clicks over
    // empty desktop. Replay them on the element under the pointer, with the focus change a real press would make.
    const unDbl = listen<["down" | "up", number, number, boolean]>("desktop-mouse", ({ payload: [kind, px, py, dbl] }) => {
      const x = px / devicePixelRatio, y = py / devicePixelRatio;
      const el = document.elementFromPoint(x, y);
      if (!el) return;
      const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
      if (kind === "down") {
        if (!el.dispatchEvent(new MouseEvent("mousedown", { ...o, buttons: 1 }))) return; // the page kept focus where it is
        const f = el.closest<HTMLElement>("input, textarea, select, button, [tabindex]");
        if (f) f.focus();
        else (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (el instanceof HTMLInputElement && el.type === "range") {
        // Only press and release are forwarded, never moves, so a drag can't happen: a click sets the value under the pointer.
        const r = el.getBoundingClientRect(), lo = Number(el.min), hi = Number(el.max);
        el.value = String(Math.round(lo + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (hi - lo)));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      el.dispatchEvent(new MouseEvent("mouseup", o));
      el.dispatchEvent(new MouseEvent("click", o));
      if (dbl) el.dispatchEvent(new MouseEvent("dblclick", o));
    });
    // Pinned, the wheel arrives the same way (desktop.rs). A script wheel event scrolls nothing, so scroll the nearest
    // scrollable box under the pointer by hand: 120 per notch is one notch, about 100px as WebView2 scrolls it.
    // Each turn only moves a target; a frame loop eases toward it (25% of the gap, snap under 4px), so fast turns add up.
    let glide: { el: Element; to: number } | null = null;
    let glideFrame = 0;
    const step = () => {
      if (!glide) return;
      const d = glide.to - glide.el.scrollTop;
      if (Math.abs(d) < 4) {
        glide.el.scrollTop = glide.to;
        glide = null;
        return;
      }
      glide.el.scrollTop += d * 0.25;
      glideFrame = requestAnimationFrame(step);
    };
    const unWheel = listen<[number, number, number]>("desktop-wheel", ({ payload: [px, py, delta] }) => {
      let el = document.elementFromPoint(px / devicePixelRatio, py / devicePixelRatio);
      for (; el; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) break;
      }
      el ??= document.scrollingElement;
      if (!el) return;
      const dy = (-delta / 120) * 100;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return el.scrollBy({ top: dy });
      if (glide && glide.el !== el) glide.el.scrollTop = glide.to; // pointer moved to another box: finish the old one
      const from = glide?.el === el ? glide.to : el.scrollTop;
      glide = { el, to: Math.max(0, Math.min(el.scrollHeight - el.clientHeight, from + dy)) };
      cancelAnimationFrame(glideFrame);
      glideFrame = requestAnimationFrame(step);
    });
    const unMoved = win.onMoved(onGeometry);
    const unResized = win.onResized(onGeometry);
    const clock = setInterval(bump, 60_000); // keeps "today" right when the app stays open past midnight
    return () => {
      void unlisten.then((f) => f());
      void unDbl.then((f) => f());
      void unWheel.then((f) => f());
      cancelAnimationFrame(glideFrame);
      void unMoved.then((f) => f());
      void unResized.then((f) => f());
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, []);

  /** Merges into the latest settings, so writes from listeners and the dialog never drop each other's keys. */
  const saveSettings = async (patch: Partial<Settings>) => {
    const s = { ...prefs.current, ...patch };
    prefs.current = s;
    setSettings(s);
    await tauriLocal.write(SETTINGS_PATH, JSON.stringify(s, null, 2) + "\n");
  };

  // sync keeps the same array until its data changes; a fresh filter() per render would make Calendar re-measure every cell.
  const stored = engine?.sync.events();
  const visibleEvents = useMemo(() => stored?.filter((e) => !e.deleted) ?? [], [stored]);

  if (fatal) return <p class="fatal" role="alert">{tr.fatal}{fatal}</p>;
  if (!engine) return <p class="fatal">{tr.loading}</p>;

  const { sync, live } = engine;
  const status = sync.status();
  const [stLabel, stHint] = tr.states[status.state];
  const StIcon = ICON[status.state];
  const title = calendarTitle(view, sel);
  const now = today();
  const pinned = settings.alwaysBottom;
  const drag = pinned ? "false" : "true"; // pinned: the header no longer moves the window

  const saveEvent = async (e: Event) => {
    setEditEvent(null);
    await sync.saveEvent(e);
    bump();
  };
  const saveTask = async (t: Task) => {
    setEditTask(null);
    await sync.saveTask(t);
    bump();
  };
  const syncNow = async () => {
    setSyncing(true);
    await sync.syncNow();
    setSyncing(false);
  };

  return (
    <div class={`app${settings.opacity < 100 ? " clear" : ""}${pinned ? " pinned" : ""}`} style={`--opacity: ${settings.opacity / 100}`}>
      {/* No title bar: the header's empty parts move the window (Tauri drag region applies to the marked element itself, not its children). */}
      <header class="bar" data-tauri-drag-region={drag}>
        <div class="nav" data-tauri-drag-region={drag}>
          <button type="button" class="icon" aria-label={view === "month" ? tr.prevMonth : tr.prevWeek}
            onClick={() => setSel(shift(view, sel, -1))}><Prev /></button>
          <button type="button" onClick={() => setSel(now)}>{tr.today}</button>
          <button type="button" class="icon" aria-label={view === "month" ? tr.nextMonth : tr.nextWeek}
            onClick={() => setSel(shift(view, sel, 1))}><Next /></button>
          {/* Spans let a narrow header drop the year or switch to the short title; each needs its own drag mark. */}
          <h1 data-tauri-drag-region={drag}>
            {tr.yearFirst && <span class="year" data-tauri-drag-region={drag}>{title.year}</span>}
            <span class="full" data-tauri-drag-region={drag}>{title.main}</span>
            {!tr.yearFirst && <span class="year" data-tauri-drag-region={drag}>{title.year}</span>}
            {title.short && <span class="short" data-tauri-drag-region={drag}>{title.short}</span>}
          </h1>
        </div>
        <div class="seg" role="group" aria-label={tr.view}>
          {/* The abbreviation takes over at ≤640px, where the English words would squeeze out the title. */}
          <button type="button" aria-label={tr.month} aria-pressed={view === "month"} onClick={() => setView("month")}>
            <span class="long">{tr.month}</span><span class="abbr">{tr.monthAbbr}</span></button>
          <button type="button" aria-label={tr.week} aria-pressed={view === "week"} onClick={() => setView("week")}>
            <span class="long">{tr.week}</span><span class="abbr">{tr.weekAbbr}</span></button>
        </div>
        <button type="button" disabled={!pinned} title={pinned ? undefined : tr.moveMode}
          onClick={() => setEditEvent({ event: newEvent(sel), isNew: true })}>{tr.routine}</button>
        <span class="spacer" data-tauri-drag-region={drag} />
        <div class="sync" data-tauri-drag-region={drag}>
          <span class={`status ${live ? status.state : "local"}`} role="status" title={live ? stHint : undefined}>
            <span class="sr-only">{tr.syncState}</span>
            {live ? <><StIcon /> <span class="label">{stLabel}</span></> : <><Offline /> <span class="label">{tr.notConnected}</span></>}
          </span>
          {live && <button type="button" class="sync-now" onClick={syncNow} disabled={syncing}>{syncing ? tr.syncing : tr.syncNow}</button>}
        </div>
        <button type="button" class="icon pin" aria-label={tr.pin} aria-pressed={pinned}
          title={pinned ? tr.pinnedTitle : tr.unpinnedTitle}
          onClick={async () => {
            if (!pinned && !(await canPin())) return setOffScreen(true);
            await applyPin(!pinned);
            await saveSettings({ alwaysBottom: !pinned });
          }}><Pin /></button>
        <button type="button" class="icon" aria-label={tr.settings} onClick={() => setShowSettings(true)}><Gear /></button>
        <button type="button" class="icon" aria-label={tr.close} title={tr.close}
          onClick={() => void getCurrentWindow().hide()}><Close /></button>
        <button type="button" class="icon" aria-label={tr.memoPanel} aria-pressed={!!settings.memoOpen} title={tr.memoPanel}
          onClick={() => void saveSettings({ memoOpen: !settings.memoOpen })}><Menu /></button>
      </header>

      {!settings.introSeen && (
        <div class="notices intro" role="region" aria-label={tr.introLabel}>
          <p>{tr.intro}</p>
          <p class="actions">
            <button type="button" onClick={() => { void saveSettings({ introSeen: true }); setShowSettings(true); }}>{tr.openSettings}</button>
            <button type="button" onClick={() => void saveSettings({ introSeen: true })}>{tr.ok}</button>
          </p>
        </div>
      )}
      <Notices live={live} state={status.state} held={status.held} clockSkew={status.clockSkew} publicRepo={status.publicRepo} error={status.error}
        extra={[...(offScreen ? [tr.offScreen] : []), ...(pinned ? [] : [tr.moveMode])]} />

      {/* Unpinned is for moving and resizing only (session 22): the calendar and tasks take no input. */}
      <main class={settings.memoOpen ? "body" : "body no-memo"} inert={!pinned}>
        <Calendar view={view} sel={sel} today={now} events={visibleEvents} tasks={sync.tasks()}
          onSelect={setSel} onEditing={setCellEdit}
          onSaveTasks={(ts) => void Promise.all(ts.map((t) => sync.saveTask(t))).then(bump)}
          // An occurrence is a copy with shifted dates: edit the stored series, remember which day was clicked.
          onOpen={(e) => setEditEvent({ event: sync.events().find((x) => x.id === e.id) ?? e, isNew: false, day: e.start.slice(0, 10) })} />
        <TaskPanel tasks={sync.tasks()} today={now} onSave={saveTask} onOpen={setEditTask} />
      </main>

      {editEvent && (
        // key: picking a routine from the new-routine list swaps in a fresh dialog with that routine's form.
        <EventDialog key={editEvent.event.id} event={editEvent.event} isNew={editEvent.isNew} day={editEvent.day}
          {...routineList(sync.events(), now)}
          onPick={(e) => setEditEvent({ event: e, isNew: false })}
          onSave={saveEvent} onClose={() => setEditEvent(null)} />
      )}
      {editTask && <TaskDialog task={editTask} onSave={saveTask} onClose={() => setEditTask(null)} />}
      {showSettings && (
        <SettingsDialog settings={settings} live={live} hasToken={engine.hasToken}
          unsynced={status.state === "pending" || status.state === "offline"} unpushed={status.unpushed}
          onConnect={async (s, token) => {
            // Check before storing: a token for a public repo is never saved.
            if (!(await invoke<boolean>("gh_private", { owner: s.owner, repo: s.repo, token: token || null })))
              throw tr.publicRepo;
            if (token) await invoke("secret_set", { token });
            await saveSettings(s);
            await reconnect(s);
          }}
          onDisconnect={() => reconnect(settings, () => invoke("secret_delete"))}
          onClearLocal={() => reconnect(settings, () => invoke("local_clear"))}
          onAutostart={async (v) => {
            await applyAutostart(v);
            await saveSettings({ autostart: v });
          }}
          onLang={(l) => {
            applyLang(l);
            void saveSettings({ lang: l });
          }}
          onOpacity={(v, save) => (save ? void saveSettings({ opacity: v }) : setSettings({ ...settings, opacity: v }))}
          onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function Notices(p: { live: boolean; state: SyncState; held: string[]; clockSkew: boolean; publicRepo: boolean; error?: string; extra: string[] }) {
  const lines: string[] = [...p.extra];
  if (p.held.length) lines.push(tr.held(p.held.join(", ")));
  if (p.clockSkew) lines.push(tr.clockSkew);
  if (p.publicRepo) lines.push(tr.publicNow);
  if (p.live && p.state === "offline" && p.error) lines.push(tr.unreachable(p.error));
  if (!lines.length) return null;
  return (
    <div class="notices" role="alert">
      {lines.map((l) => <p key={l}><Warn /> {l}</p>)}
    </div>
  );
}
