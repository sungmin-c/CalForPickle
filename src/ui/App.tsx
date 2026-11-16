import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Event, Task } from "../model";
import { createSync, tauriLocal, tauriRemote, type Remote, type SyncState } from "../sync";
import { Calendar, calendarTitle, shift, type View } from "./Calendar";
import { today } from "./dates";
import { EventDialog, newEvent, TaskDialog } from "./Dialogs";
import { Check, Clock, Close, Merge, Next, Offline, Prev, Gear, Menu, Warn } from "./icons";
import { fitsOnScreen, normalizeSettings, type Settings } from "./prefs";
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
  if (s.alwaysBottom) await w.setAlwaysOnBottom(true);
}

async function applyAutostart(on: boolean) {
  if (!import.meta.env.PROD) return; // a dev run would register the target\debug exe in the Run key
  if ((await isEnabled()) !== on) await (on ? enable() : disable());
}

const STATE: Record<SyncState, { label: string; hint: string; Icon: () => preact.JSX.Element }> = {
  done: { label: "완료", hint: "모든 변경이 GitHub에 올라갔습니다", Icon: Check },
  pending: { label: "대기", hint: "올릴 변경이 있습니다. 마지막 편집 15초 뒤에 올립니다", Icon: Clock },
  offline: { label: "오프라인", hint: "GitHub에 닿지 못했습니다. 변경은 이 PC에 저장돼 있습니다", Icon: Offline },
  merged: { label: "병합됨", hint: "GitHub에 있던 변경을 합쳤습니다", Icon: Merge },
};

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const ref = useRef<Engine | null>(null);
  const [settings, setSettings] = useState<Settings>(() => normalizeSettings(null));
  const prefs = useRef(settings); // latest saved settings, for writes from event listeners
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const [view, setView] = useState<View>("month");
  const [sel, setSel] = useState(today());
  const [editEvent, setEditEvent] = useState<{ event: Event; isNew: boolean; day?: string } | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [showSettings, setShowSettings] = useState(false);
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
      prefs.current = s;
      setSettings(s);
      await restoreWindow(s).catch(console.error);
      await win.show();
      last = JSON.stringify(await geometry());
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
      // Win+D minimizes even an always-on-bottom window (session 5); on the desktop it should stay put.
      void win.isMinimized().then((min) => {
        if (min && prefs.current.alwaysBottom) return win.unminimize();
      });
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if ((await win.isMinimized()) || (await win.isMaximized())) return;
        const g = await geometry();
        if (JSON.stringify(g) === last) return;
        last = JSON.stringify(g);
        await saveSettings({ window: g });
      }, 500);
    };
    // tao forces HWND_BOTTOM on every z-order change while always-bottom is on, so a clicked or Alt+Tabbed window
    // would stay hidden behind the app you just left. While focused it sits in front; it goes back down on blur.
    // Clearing the flag sends HWND_NOTOPMOST, a no-op for a window that isn't topmost: the top on/off pair raises it.
    const unFocus = win.onFocusChanged(async ({ payload: focused }) => {
      if (!prefs.current.alwaysBottom) return;
      if (!focused) return win.setAlwaysOnBottom(true);
      await win.setAlwaysOnBottom(false);
      await win.setAlwaysOnTop(true);
      await win.setAlwaysOnTop(false);
    });
    const unMoved = win.onMoved(onGeometry);
    const unResized = win.onResized(onGeometry);
    const clock = setInterval(bump, 60_000); // keeps "today" right when the app stays open past midnight
    return () => {
      void unlisten.then((f) => f());
      void unFocus.then((f) => f());
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

  if (fatal) return <p class="fatal" role="alert">시작하지 못했습니다: {fatal}</p>;
  if (!engine) return <p class="fatal">불러오는 중…</p>;

  const { sync, live } = engine;
  const status = sync.status();
  const st = STATE[status.state];
  const now = today();

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
    <div class={settings.opacity < 100 ? "app clear" : "app"} style={`--opacity: ${settings.opacity / 100}`}>
      {/* No title bar: the header's empty parts move the window (Tauri drag region applies to the marked element itself, not its children). */}
      <header class="bar" data-tauri-drag-region>
        <div class="nav" data-tauri-drag-region>
          <button type="button" class="icon" aria-label={view === "month" ? "이전 달" : "이전 주"}
            onClick={() => setSel(shift(view, sel, -1))}><Prev /></button>
          <button type="button" onClick={() => setSel(now)}>오늘</button>
          <button type="button" class="icon" aria-label={view === "month" ? "다음 달" : "다음 주"}
            onClick={() => setSel(shift(view, sel, 1))}><Next /></button>
          <h1 data-tauri-drag-region>{calendarTitle(view, sel)}</h1>
        </div>
        <div class="seg" role="group" aria-label="보기">
          <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}>월</button>
          <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>주</button>
        </div>
        <button type="button" onClick={() => setEditEvent({ event: newEvent(sel), isNew: true })}>루틴</button>
        <span class="spacer" data-tauri-drag-region />
        <div class="sync" data-tauri-drag-region>
          <span class={`status ${live ? status.state : "local"}`} role="status" title={live ? st.hint : undefined}>
            <span class="sr-only">동기화 상태: </span>
            {live ? <><st.Icon /> {st.label}</> : <><Offline /> 연결 안 됨</>}
          </span>
          {live && <button type="button" onClick={syncNow} disabled={syncing}>{syncing ? "동기화 중…" : "지금 동기화"}</button>}
        </div>
        <button type="button" class="icon" aria-label="설정" onClick={() => setShowSettings(true)}><Gear /></button>
        <button type="button" class="icon" aria-label="닫기 (트레이로 숨김)" title="닫기 (트레이로 숨김)"
          onClick={() => void getCurrentWindow().hide()}><Close /></button>
        <button type="button" class="icon" aria-label="메모 패널" aria-pressed={!!settings.memoOpen} title="메모 패널"
          onClick={() => void saveSettings({ memoOpen: !settings.memoOpen })}><Menu /></button>
      </header>

      {!settings.introSeen && (
        <div class="notices intro" role="region" aria-label="처음 안내">
          <p>Windows를 켤 때 자동으로 실행되게 하려면 설정에서 "Windows 시작 시 실행"을 켜세요. 지금은 꺼져 있습니다.</p>
          <p class="actions">
            <button type="button" onClick={() => { void saveSettings({ introSeen: true }); setShowSettings(true); }}>설정 열기</button>
            <button type="button" onClick={() => void saveSettings({ introSeen: true })}>확인</button>
          </p>
        </div>
      )}
      <Notices live={live} state={status.state} held={status.held} clockSkew={status.clockSkew} error={status.error} />

      <main class={settings.memoOpen ? "body" : "body no-memo"}>
        <Calendar view={view} sel={sel} today={now} events={sync.events().filter((e) => !e.deleted)} tasks={sync.tasks()}
          onSelect={setSel}
          onSaveTasks={(ts) => void Promise.all(ts.map((t) => sync.saveTask(t))).then(bump)}
          // An occurrence is a copy with shifted dates: edit the stored series, remember which day was clicked.
          onOpen={(e) => setEditEvent({ event: sync.events().find((x) => x.id === e.id) ?? e, isNew: false, day: e.start.slice(0, 10) })} />
        <TaskPanel tasks={sync.tasks()} today={now} onSave={saveTask} onOpen={setEditTask} />
      </main>

      {editEvent && (
        // key: picking a routine from the new-routine list swaps in a fresh dialog with that routine's form.
        <EventDialog key={editEvent.event.id} event={editEvent.event} isNew={editEvent.isNew} day={editEvent.day}
          routines={sync.events().filter((e) => e.recurrence && !e.deleted).sort((a, b) => a.title.localeCompare(b.title, "ko"))}
          onPick={(e) => setEditEvent({ event: e, isNew: false })}
          onSave={saveEvent} onClose={() => setEditEvent(null)} />
      )}
      {editTask && <TaskDialog task={editTask} onSave={saveTask} onClose={() => setEditTask(null)} />}
      {showSettings && (
        <SettingsDialog settings={settings} live={live} hasToken={engine.hasToken}
          unsynced={status.state === "pending" || status.state === "offline"} unpushed={status.unpushed}
          onConnect={async (s, token) => {
            if (token) await invoke("secret_set", { token });
            if (!(await invoke<boolean>("gh_private", { owner: s.owner, repo: s.repo })))
              throw "공개(public) 저장소에는 연결할 수 없습니다. 누구나 일정을 볼 수 있게 됩니다. private 저장소를 만들어 쓰세요.";
            await saveSettings(s);
            await reconnect(s);
          }}
          onDisconnect={() => reconnect(settings, () => invoke("secret_delete"))}
          onClearLocal={() => reconnect(settings, () => invoke("local_clear"))}
          onAlwaysBottom={async (v) => {
            if (!v) await getCurrentWindow().setAlwaysOnBottom(false); // turning it on waits for blur: the settings window is in use
            await saveSettings({ alwaysBottom: v });
          }}
          onAutostart={async (v) => {
            await applyAutostart(v);
            await saveSettings({ autostart: v });
          }}
          onOpacity={(v, save) => (save ? void saveSettings({ opacity: v }) : setSettings({ ...settings, opacity: v }))}
          onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function Notices(p: { live: boolean; state: SyncState; held: string[]; clockSkew: boolean; error?: string }) {
  const lines: string[] = [];
  if (p.held.length)
    lines.push(`GitHub의 ${p.held.join(", ")} 을(를) 읽지 못해 병합을 보류했습니다. 레포에서 JSON을 고친 뒤 지금 동기화를 누르세요.`);
  if (p.clockSkew)
    lines.push("받은 항목의 수정 시각이 이 PC 시계보다 10분 넘게 앞섭니다. 이 PC와 Pickle 쪽 시계를 확인하세요.");
  if (p.live && p.state === "offline" && p.error) lines.push(`GitHub에 닿지 못했습니다: ${p.error}`);
  if (!lines.length) return null;
  return (
    <div class="notices" role="alert">
      {lines.map((l) => <p key={l}><Warn /> {l}</p>)}
    </div>
  );
}
