// @ts-expect-error no @types/node (same as prefs.test.ts)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = read("../src/ui/App.tsx");
const cal = read("../src/ui/Calendar.tsx");

// Calendar re-measures every cell (render all rows, measure, render again) whenever `events` changes identity
// or the grid resizes. Measured both firing needlessly: a day arrow key, and every frame of the
// 0.2s memo panel transition (12 passes, frames up to 150ms with 1,638 tasks).
describe("calendar re-measure", () => {
  it("App passes a memoized events array, not a fresh filter() per render", () => {
    expect(app).not.toMatch(/events=\{sync\.events\(\)\.filter/);
    expect(app).toMatch(/useMemo\(/);
  });

  it("Calendar waits for resizing to stop before re-measuring", () => {
    expect(cal).not.toMatch(/new ResizeObserver\(\(\) => setFit\(null\)\)/);
    expect(cal).toMatch(/new ResizeObserver\([^)]*\)\s*=>\s*\{?[^}]*setTimeout/);
  });
});
