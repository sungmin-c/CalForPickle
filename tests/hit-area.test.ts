// @ts-expect-error no @types/node (same as prefs.test.ts)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = read("../src/ui/app.css");

// Body of the first top-level rule whose selector is exactly `sel`.
const rule = (sel: string) => {
  const esc = sel.replace(/[.[\]]/g, "\\$&");
  const m = css.match(new RegExp(`^${esc}\\s*\\{([^}]*)\\}`, "m"));
  if (!m) throw new Error(`no rule for ${sel}`);
  return m[1];
};

// WCAG 2.5.8: targets are at least 24x24 CSS px. Rows stay 20px tall (dayList.ts fitRows), so the extra
// 2px above and below is hit area only, not layout.
describe("24px click targets", () => {
  it.each([".chip", ".more", ".hit", "label.check"])("%s is at least 24px tall", (sel) => {
    expect(rule(sel)).toMatch(/min-height:\s*24px/);
  });

  it(".hit is at least 24px wide", () => {
    expect(rule(".hit")).toMatch(/width:\s*24px/);
  });

  it.each([".chip", ".more"])("%s pulls its extra height back with a negative margin", (sel) => {
    expect(rule(sel)).toMatch(/margin-block:\s*-2px/);
  });

  // Measured in Chromium (session 39): with plain `overflow: hidden` the 2px overhang of the first row is clipped, so its
  // click area was 22px. `clip` + `overflow-clip-margin` lets the overhang through without changing layout.
  it(".items does not clip the 2px click-area overhang of the first and last row", () => {
    const body = rule(".cell .items");
    expect(body).toMatch(/overflow:\s*clip/);
    expect(body).toMatch(/overflow-clip-margin:\s*2px/);
    expect(body).not.toMatch(/overflow:\s*hidden\s*;/); // the declaration, not the comment that mentions li's overflow
  });

  // Narrow windows: the time ("10:00") eats the chip, so the title is cut off. Hide it in month view only.
  it("hides the time on month chips at <=760px, so the title stays visible", () => {
    const m = css.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/g)?.join("\n") ?? "";
    expect(m).toMatch(/\.month \.chip time\s*\{\s*display:\s*none/);
  });

  it.each(["Calendar.tsx", "Tasks.tsx"])("every checkbox in %s sits inside label.hit", (file) => {
    const src = read(`../src/ui/${file}`);
    const boxes = src.match(/type="checkbox"/g)?.length ?? 0;
    const wrapped = src.match(/<label class="hit"(?:(?!<\/label>)[\s\S])*?<input type="checkbox"/g)?.length ?? 0;
    expect(boxes).toBeGreaterThan(0);
    expect(wrapped).toBe(boxes);
  });
});
