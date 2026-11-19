/** App settings in %APPDATA%\CalForPickle\settings.json. Not part of the synced data layer. */
import type { Lang } from "../i18n";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Settings {
  owner?: string;
  repo?: string;
  /** Pinned to the desktop (header pin button): always under other windows, not movable or resizable. */
  alwaysBottom: boolean;
  autostart: boolean;
  /** Screen language; also picks the holidays (ko: Korean, en: US federal). */
  lang: Lang;
  /** Window background opacity in percent, MIN_OPACITY..100. */
  opacity: number;
  /** The first-run note about autostart was dismissed. */
  introSeen?: boolean;
  /** The memo panel was left open. */
  memoOpen?: boolean;
  /** Outer position and inner size in physical pixels. */
  window?: Rect;
}

/** The background may vanish completely (app.css .clear). */
export const MIN_OPACITY = 0;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Broken or missing settings fall back to defaults instead of stopping the app. */
export function normalizeSettings(raw: string | null): Settings {
  let v: unknown;
  try {
    v = raw ? JSON.parse(raw) : {};
  } catch {
    v = {};
  }
  const o = isObj(v) ? v : {};
  const s: Settings = {
    alwaysBottom: o.alwaysBottom === true,
    autostart: o.autostart === true, // off until the user turns it on (session 10): installing must not register a startup entry
    lang: o.lang === "en" ? "en" : "ko",
    opacity: typeof o.opacity === "number" && Number.isFinite(o.opacity)
      ? Math.min(100, Math.max(MIN_OPACITY, Math.round(o.opacity)))
      : 100,
  };
  if (o.introSeen === true) s.introSeen = true;
  if (o.memoOpen === true) s.memoOpen = true;
  if (typeof o.owner === "string") s.owner = o.owner;
  if (typeof o.repo === "string") s.repo = o.repo;
  const w = o.window;
  if (isObj(w) && isInt(w.x) && isInt(w.y) && isInt(w.width) && isInt(w.height) && w.width > 0 && w.height > 0)
    s.window = { x: w.x, y: w.y, width: w.width, height: w.height };
  return s;
}

/** The top 30 px (the header, which is the drag handle) must sit inside one monitor's work area, at least 100 px wide, so the window can be dragged back. */
export function fitsOnScreen(win: Rect, screens: Rect[]): boolean {
  return screens.some((m) => {
    const visible = Math.min(win.x + win.width, m.x + m.width) - Math.max(win.x, m.x);
    return visible >= 100 && win.y >= m.y && win.y + 30 <= m.y + m.height;
  });
}

/** Pinning needs the whole window on one monitor (full bounds, not the work area: the desktop runs under the taskbar too). */
export function insideOneScreen(win: Rect, screens: Rect[]): boolean {
  return screens.some((m) =>
    win.x >= m.x && win.y >= m.y && win.x + win.width <= m.x + m.width && win.y + win.height <= m.y + m.height);
}
