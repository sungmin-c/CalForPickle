import { describe, expect, it } from "vitest";
import { commitDay, dayList, fitRows } from "../src/ui/dayList";
import { task } from "./fixtures";

const D = "2026-11-20";

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

  it("saves a color change, a new colored line, and removes the key for no color", () => {
    const prev = [task({ id: "a", due: D, title: "가", order: 0 }), task({ id: "b", due: D, title: "나", order: 1, color: "#F12424" })];
    const out = commitDay(D, prev, [
      { id: "a", title: "가", done: false, color: "#2456B8" },
      { id: "b", title: "나", done: false },
      { id: "n", title: "새", done: false, color: "#1A7F37" },
    ]);
    expect(out).toEqual([
      { ...prev[0], color: "#2456B8" },
      { ...prev[1], color: undefined },
      { id: "n", title: "새", status: "todo", due: D, order: 2, notes: "", updatedAt: "", deleted: false, color: "#1A7F37" },
    ]);
    expect("color" in out[1]).toBe(false);
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
    expect(fitRows([22, 48], 10)).toBe(0);
  });
  it("ignores sub-pixel rounding", () => {
    expect(fitRows([22, 48.4], 48)).toBe(2);
  });
});
