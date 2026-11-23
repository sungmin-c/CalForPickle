import { describe, expect, it } from "vitest";
import { clampLines, commitDay, dayList, fitRows, reflow } from "../src/ui/dayList";
import { task } from "./fixtures";

const D = "2026-11-20";

describe("reflow", () => {
  const old = [{ id: "a", title: "윗문장", done: false }, { id: "b", title: "아랫문장", done: true }];
  const blank = () => ({ id: "new", title: "", done: false });
  const ids = (r: { id: string }[]) => r.map((x) => x.id);

  it("typing in a line keeps every id", () => {
    const out = reflow(old, ["윗문장", "아랫문장!"], blank);
    expect(out.map((r) => [r.id, r.title, r.done])).toEqual([["a", "윗문장", false], ["b", "아랫문장!", true]]);
  });
  it("Enter at the start of the lower line puts a blank between them and the lower line keeps its id and done flag", () => {
    const out = reflow(old, ["윗문장", "", "아랫문장"], blank);
    expect(ids(out)).toEqual(["a", "new", "b"]);
    expect(out[2]).toEqual(old[1]);
  });
  it("Enter in the middle of a line: the first part keeps the id, the rest is a new line", () => {
    const out = reflow(old, ["윗문장", "아랫", "문장"], blank);
    expect(out.map((r) => [r.id, r.title])).toEqual([["a", "윗문장"], ["b", "아랫"], ["new", "문장"]]);
  });
  it("Backspace joining two lines keeps the upper id and drops the lower", () => {
    expect(reflow(old, ["윗문장아랫문장"], blank).map((r) => r.id)).toEqual(["a"]);
  });
  it("deleting a whole line drops only that one", () => {
    expect(ids(reflow(old, ["아랫문장"], blank))).toEqual(["b"]);
    expect(ids(reflow(old, ["윗문장"], blank))).toEqual(["a"]);
  });
  it("pasted lines after the last one are new lines", () => {
    expect(ids(reflow(old, ["윗문장", "아랫문장", "x", "y"], blank))).toEqual(["a", "b", "new", "new"]);
  });
  it("replacing a selection across lines reuses the ids in order", () => {
    expect(reflow(old, ["윗새로운"], blank).map((r) => [r.id, r.title])).toEqual([["a", "윗새로운"]]);
  });
  it("an empty text is one empty line", () => {
    expect(reflow(old, [""], blank).map((r) => [r.id, r.title])).toEqual([["a", ""]]);
  });
});

describe("dayList", () => {
  it("keeps that day's live tasks: open first, then by order, unordered last by title", () => {
    const list = dayList([
      task({ id: "a", due: D, title: "다", status: "done", order: 0 }),
      task({ id: "b", due: D, title: "나" }),
      task({ id: "c", due: D, title: "가" }),
      task({ id: "d", due: D, title: "라", order: 1 }),
      task({ id: "e", due: D, title: "마", order: 0, status: "doing" }),
      task({ id: "f", due: D, title: "x", deleted: true }),
      task({ id: "g", due: "2026-11-21", title: "y" }),
      task({ id: "h", title: "z" }),
    ], D);
    expect(list.map((t) => t.id)).toEqual(["e", "d", "c", "b", "a"]);
  });
});

describe("commitDay", () => {
  const old = [
    task({ id: "a", due: D, title: "첫째", order: 0 }),
    task({ id: "b", due: D, title: "둘째", order: 1, status: "doing" }),
  ];

  it("saves nothing when nothing changed", () => {
    expect(commitDay(D, old, [{ id: "a", title: "첫째", done: false }, { id: "b", title: "둘째", done: false }])).toEqual([]);
  });

  it("creates, renumbers, retitles, completes and deletes in one pass", () => {
    const out = commitDay(D, old, [
      { id: "n", title: " 새 줄 ", done: false },
      { id: "a", title: "첫째 고침", done: true },
      { id: "x", title: "   ", done: false }, // blank new line: dropped
    ]);
    expect(out).toEqual([
      { id: "n", title: "새 줄", status: "todo", due: D, order: 0, notes: "", updatedAt: "", deleted: false },
      { ...old[0], title: "첫째 고침", status: "done", order: 1 },
      { ...old[1], deleted: true },
    ]);
  });

  it("keeps doing while not done, and reopens a done task as todo", () => {
    const prev = [...old, task({ id: "c", due: D, title: "셋째", order: 2, status: "done" })];
    const out = commitDay(D, prev, [
      { id: "a", title: "첫째", done: false },
      { id: "b", title: "둘째", done: false },
      { id: "c", title: "셋째", done: false },
    ]);
    expect(out).toEqual([{ ...prev[2], status: "todo" }]);
  });

  it("gives imported tasks without order an order on first edit", () => {
    const prev = [task({ id: "a", due: D, title: "가" })];
    expect(commitDay(D, prev, [{ id: "a", title: "가", done: false }])).toEqual([{ ...prev[0], order: 0 }]);
  });
});

describe("fitRows", () => {
  it("shows every row when the last one fits", () => {
    expect(fitRows([22, 48, 74], 74)).toBe(3);
    expect(fitRows([], 10)).toBe(0);
  });
  it("gives the last row that fits to \"+N\" when rows are cut", () => {
    expect(fitRows([22, 48, 74, 100], 90)).toBe(2); // 3 fit, one of them becomes "+2"
    expect(fitRows([22, 48], 30)).toBe(0); // only "+2" is left
  });
  it("shows a first row taller than the cell instead of only \"+N\"", () => {
    expect(fitRows([150, 176], 100)).toBe(1);
    expect(fitRows([22, 48], 10)).toBe(1);
  });
  it("shows only \"+N\" when the cell holds one row but not the row plus \"+N\"", () => {
    expect(fitRows([60, 84], 32)).toBe(0); // first row wrapped taller than the cell; 20px row + 4px gap + 20px "+N" = 44 > 32 (measured at 480px)
    expect(fitRows([60, 84], 44)).toBe(1); // room for one clamped line and "+N"
    expect(fitRows([60], 32)).toBe(1); // a lone row needs no "+N"
  });
  it("leaves room for \"+N\" when the rows differ in height (wrapped tasks)", () => {
    expect(fitRows([22, 100], 40)).toBe(0); // row 1 fits but "+N" would not fit under it
    expect(fitRows([22, 100], 50)).toBe(1);
  });
  it("ignores sub-pixel rounding", () => {
    expect(fitRows([22, 48.4], 48)).toBe(2);
  });
});

describe("clampLines", () => {
  it("keeps whole lines and leaves room for \"+N\"", () => {
    expect(clampLines(88, 18, 24)).toBe(3); // (88 - 24 - 2) / 18
    expect(clampLines(88, 18, 0)).toBe(4);
  });
  it("shows at least one line", () => {
    expect(clampLines(20, 18, 24)).toBe(1);
  });
});
