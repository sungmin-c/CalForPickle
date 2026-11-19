import { describe, expect, it } from "vitest";
import { mergeItems, pruneTombstones } from "../src/merge";
import { nextStamp } from "../src/model";
import { partition } from "../src/partition";
import { ev, task } from "./fixtures";

const T = "2026-11-15T10:00:00.000+09:00";

describe("1. updatedAt tie", () => {
  it("deleted side wins, regardless of argument order", () => {
    const live = task({ id: "a", title: "zzz", updatedAt: T });
    const dead = task({ id: "a", title: "aaa", updatedAt: T, deleted: true });
    expect(mergeItems([live], [dead])).toEqual([dead]);
    expect(mergeItems([dead], [live])).toEqual([dead]);
  });

  it("then the lexicographically larger canonical JSON wins, both directions", () => {
    const a = task({ id: "a", title: "apple", updatedAt: T });
    const b = task({ id: "a", title: "banana", updatedAt: T });
    // {"id":"a","title":"banana",...} > {"id":"a","title":"apple",...}
    expect(mergeItems([a], [b])).toEqual([b]);
    expect(mergeItems([b], [a])).toEqual([b]);
  });

  it("treats the same instant in different offsets as a tie", () => {
    const a = task({ id: "a", title: "apple", updatedAt: "2026-11-15T10:00:00.000+09:00" });
    const b = task({ id: "a", title: "banana", updatedAt: "2026-11-15T01:00:00.000Z" });
    expect(mergeItems([b], [a])).toEqual([b]);
  });
});

describe("2. clock skew", () => {
  it("a lagging clock still produces a stamp 1ms after the previous one", () => {
    const prev = "2026-11-15T10:00:00.000+09:00";
    const lagging = new Date("2026-11-15T09:00:00+09:00");
    expect(nextStamp(prev, lagging)).toBe("2026-11-15T10:00:00.001+09:00");
  });

  it("a correct clock uses now, formatted in Seoul time", () => {
    const now = new Date("2026-11-15T03:04:05.678Z");
    expect(nextStamp("2026-11-14T00:00:00.000+09:00", now)).toBe("2026-11-15T12:04:05.678+09:00");
    expect(nextStamp(undefined, now)).toBe("2026-11-15T12:04:05.678+09:00");
  });
});

describe("3. event moved to another month", () => {
  it("dedupes the id across files and places it by its winning start", () => {
    const old = ev({ id: "x", start: "2026-11-30T10:00:00+09:00", end: "2026-11-30T11:00:00+09:00" });
    const moved = ev({
      id: "x",
      start: "2026-12-02T10:00:00+09:00",
      end: "2026-12-02T11:00:00+09:00",
      updatedAt: "2026-11-15T11:00:00.000+09:00",
    });
    const stay = ev({ id: "y", start: "2026-11-01", end: "2026-11-02", allDay: true });
    const files = partition(mergeItems([old, stay], [moved]));
    expect(files.get("data/events/2026-11.json")).toEqual([stay]);
    expect(files.get("data/events/2026-12.json")).toEqual([moved]);
  });

  it("uses the month written in start, whatever its offset (Q17)", () => {
    const e = ev({ id: "z", start: "2026-11-30T16:00:00Z", end: "2026-11-30T17:00:00Z" });
    expect([...partition([e]).keys()]).toEqual(["data/events/2026-11.json"]);
  });
});

describe("4. soft delete resurrection", () => {
  it("a newer deleted:false beats the tombstone", () => {
    const dead = task({ id: "a", deleted: true, updatedAt: T });
    const alive = task({ id: "a", updatedAt: "2026-11-15T10:00:00.001+09:00" });
    expect(mergeItems([dead], [alive])).toEqual([alive]);
  });

  it("prunes tombstones older than 90 days and keeps everything else", () => {
    const now = new Date("2026-11-15T10:00:00+09:00");
    const oldDead = task({ id: "a", deleted: true, updatedAt: "2026-08-16T09:59:59.999+09:00" });
    const recentDead = task({ id: "b", deleted: true, updatedAt: "2026-08-17T10:00:00.000+09:00" });
    const oldLive = task({ id: "c", updatedAt: "2025-01-01T00:00:00.000+09:00" });
    expect(pruneTombstones([oldDead, recentDead, oldLive], now)).toEqual([recentDead, oldLive]);
  });
});
