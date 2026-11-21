import { describe, expect, it } from "vitest";
import { memoBox } from "../src/ui/memoBox";

const cell = { left: 100, top: 200, right: 240, bottom: 300 }; // 140 x 100
const base = { col: 3, south: false, last: false, week: false, vh: 1000 };

describe("memoBox", () => {
  it("opens from the cell's top-left, a little outside it, at least 240 wide", () => {
    expect(memoBox(cell, base)).toEqual({ x: 94, y: 194, w: 240, minH: 112, maxH: 420, up: false });
  });
  it("right columns open leftward, ending 6px past the cell (0 on the last column)", () => {
    expect(memoBox(cell, { ...base, col: 5 }).x).toBe(246 - 240);
    expect(memoBox(cell, { ...base, col: 6 }).x).toBe(240 - 240);
  });
  it("the first column starts flush with the cell", () => {
    expect(memoBox(cell, { ...base, col: 0 }).x).toBe(100);
  });
  it("bottom rows open upward from the cell's bottom edge (flush on the very last row)", () => {
    expect(memoBox(cell, { ...base, south: true })).toMatchObject({ y: 306, up: true });
    expect(memoBox(cell, { ...base, south: true, last: true })).toMatchObject({ y: 300, up: true });
  });
  it("a week cell keeps to its own height", () => {
    expect(memoBox(cell, { ...base, week: true })).toMatchObject({ y: 200, minH: 0, maxH: 100, up: false });
  });
  it("a tall cell is never cut short by the 60vh cap", () => {
    expect(memoBox({ ...cell, bottom: 900 }, { ...base, vh: 500 }).maxH).toBe(712);
  });
});
