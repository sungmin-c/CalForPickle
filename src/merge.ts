import { ordered, type Item } from "./model";

const TOMBSTONE_TTL_MS = 90 * 86400_000;

/** Last-Write-Wins for one id. Deterministic: either side computes the same winner (DESIGN §7.1 #1). */
function pick<T extends Item>(a: T, b: T): T {
  const ta = Date.parse(a.updatedAt);
  const tb = Date.parse(b.updatedAt);
  if (ta !== tb) return ta > tb ? a : b;
  if (a.deleted !== b.deleted) return a.deleted ? a : b;
  return JSON.stringify(ordered(a)) >= JSON.stringify(ordered(b)) ? a : b;
}

/** Union by id across any number of lists (duplicates inside one list too), sorted by id. */
export function mergeItems<T extends Item>(...lists: T[][]): T[] {
  const byId = new Map<string, T>();
  for (const list of lists)
    for (const item of list) {
      const prev = byId.get(item.id);
      byId.set(item.id, prev ? pick(prev, item) : item);
    }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function pruneTombstones<T extends Item>(items: T[], now: Date): T[] {
  const cutoff = now.getTime() - TOMBSTONE_TTL_MS;
  return items.filter((i) => !i.deleted || Date.parse(i.updatedAt) >= cutoff);
}
