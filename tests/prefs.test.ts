// @ts-expect-error no @types/node (same as vite.config.ts); Vitest empties CSS imports, even ?raw
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fitsOnScreen, insideOneScreen, MIN_OPACITY, normalizeSettings } from "../src/ui/prefs";

const css: string = readFileSync(new URL("../src/ui/app.css", import.meta.url), "utf8");

describe("normalizeSettings", () => {
  it("gives defaults for missing, broken or non-object input", () => {
    const d = { alwaysBottom: false, autostart: false, lang: "ko", opacity: 100 };
    expect(normalizeSettings(null)).toEqual(d);
    expect(normalizeSettings("{not json")).toEqual(d);
    expect(normalizeSettings("[1,2]")).toEqual(d);
    expect(normalizeSettings("null")).toEqual(d);
  });

  it("keeps valid values and drops unknown keys", () => {
    const s = normalizeSettings(JSON.stringify({
      owner: "me", repo: "cal", alwaysBottom: true, autostart: true, lang: "en", opacity: 85, memoOpen: true,
      window: { x: -10, y: 20, width: 900, height: 600 }, junk: 1,
    }));
    expect(s).toEqual({
      owner: "me", repo: "cal", alwaysBottom: true, autostart: true, lang: "en", opacity: 85, memoOpen: true,
      window: { x: -10, y: 20, width: 900, height: 600 },
    });
  });

  it("cellPopover is kept only when exactly true", () => {
    expect(normalizeSettings('{"cellPopover": true}').cellPopover).toBe(true);
    expect("cellPopover" in normalizeSettings('{"cellPopover": "yes"}')).toBe(false);
    expect("cellPopover" in normalizeSettings("{}")).toBe(false);
  });

  it("clamps and rounds opacity, rejects wrong types", () => {
    expect(normalizeSettings('{"opacity": -5}').opacity).toBe(MIN_OPACITY);
    expect(normalizeSettings('{"opacity": 10}').opacity).toBe(10);
    expect(normalizeSettings('{"opacity": 250}').opacity).toBe(100);
    expect(normalizeSettings('{"opacity": 80.6}').opacity).toBe(81);
    expect(normalizeSettings('{"opacity": "80"}').opacity).toBe(100);
    expect(normalizeSettings('{"autostart": "no", "alwaysBottom": 1}')).toMatchObject({ autostart: false, alwaysBottom: false });
    expect(normalizeSettings('{"owner": 5}').owner).toBeUndefined();
    expect(normalizeSettings('{"lang": "fr"}').lang).toBe("ko");
    expect(normalizeSettings('{"memoOpen": "yes"}').memoOpen).toBeUndefined();
  });

  it("drops a malformed window rect", () => {
    for (const w of [{ x: 0, y: 0, width: 0, height: 600 }, { x: "1", y: 0, width: 900, height: 600 }, { x: 0, y: 0 }, null])
      expect(normalizeSettings(JSON.stringify({ window: w })).window).toBeUndefined();
  });
});

describe("fitsOnScreen", () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 2560, height: 1400 }];
  const win = (x: number, y: number) => ({ x, y, width: 1100, height: 680 });

  it("accepts a window on either monitor", () => {
    expect(fitsOnScreen(win(100, 100), screens)).toBe(true);
    expect(fitsOnScreen(win(3000, 500), screens)).toBe(true);
  });

  it("rejects a window whose title bar is off every monitor", () => {
    expect(fitsOnScreen(win(5000, 100), screens)).toBe(false); // monitor unplugged
    expect(fitsOnScreen(win(100, -40), screens)).toBe(false); // title bar above the top edge
    expect(fitsOnScreen(win(-1060, 100), screens)).toBe(false); // only 40 px left on screen
    expect(fitsOnScreen(win(-32000, -32000), screens)).toBe(false); // Windows' minimized position
    expect(fitsOnScreen(win(100, 100), [])).toBe(false);
  });

  it("accepts a window partly off screen when enough title bar is visible", () => {
    expect(fitsOnScreen(win(-900, 100), screens)).toBe(true);
  });
});

// Translucent mode: the background can go down to MIN_OPACITY. The --bg outline round glyphs and controls
// (session 11) was dropped in session 16, so over a wallpaper contrast is up to the slider; the colours that mode
// switches to still have to work on the opaque --bg.
describe("translucent mode colours", () => {
  const [light, dark] = css.split("@media (prefers-color-scheme: dark)").map(tokens);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(rgb(a)), lum(rgb(b))];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  it("lets the background go fully transparent", () => {
    expect(MIN_OPACITY).toBe(0);
  });

  it("text colours of that mode reach 4.5:1 on --bg, borders 3:1, in both themes", () => {
    for (const t of [light, dark]) {
      expect(ratio(t["--text"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t["--accent-clear"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t["--strong"], t["--bg"])).toBeGreaterThanOrEqual(3);
    }
  });

  it("today's accent day number reaches 4.5:1 on --bg, in both themes", () => {
    for (const t of [light, dark]) expect(ratio(t["--accent"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
  });

  it("weekend colours reach 4.5:1 on --bg and on --tone (keyboard-selected day), in both themes", () => {
    for (const t of [light, dark])
      for (const c of ["--sun", "--sat"])
        for (const bg of ["--bg", "--tone"]) expect(ratio(t[c], t[bg]), `${c} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("colour-dot outline reaches 3:1 on --bg and on --tone, in both themes (a dark user colour must not melt into the chip)", () => {
    const outline = css.match(/\.dot\s*\{[^}]*box-shadow:[^;}]*var\((--[\w-]+)\)/)?.[1];
    expect(outline).toBeDefined();
    for (const t of [light, dark])
      for (const bg of ["--bg", "--tone"]) expect(ratio(t[outline!], t[bg]), `${outline} on ${bg}`).toBeGreaterThanOrEqual(3);
  });
});

function tokens(block: string): Record<string, string> {
  const root = block.slice(block.indexOf(":root"));
  const body = root.slice(0, root.indexOf("}"));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

describe("insideOneScreen", () => {
  const screens = [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 2560, height: 1440 }];
  const win = (x: number, y: number, width = 1100, height = 680) => ({ x, y, width, height });

  it("accepts a window wholly on one monitor, edges included", () => {
    expect(insideOneScreen(win(100, 100), screens)).toBe(true);
    expect(insideOneScreen(win(-1920, 0, 1920, 1080), screens)).toBe(true); // exactly the left monitor
    expect(insideOneScreen(win(1460, 760), screens)).toBe(true); // touching the right and bottom edges
  });

  it("rejects a window sticking out of every monitor, or across two", () => {
    expect(insideOneScreen(win(2000, 100), screens)).toBe(false); // past the right edge
    expect(insideOneScreen(win(100, -1), screens)).toBe(false); // above the top
    expect(insideOneScreen(win(100, 800), screens)).toBe(false); // below the bottom
    expect(insideOneScreen(win(-500, 100), screens)).toBe(false); // across both monitors
    expect(insideOneScreen(win(0, 0, 2600, 680), screens)).toBe(false); // wider than the monitor
    expect(insideOneScreen(win(100, 100), [])).toBe(false);
  });
});
