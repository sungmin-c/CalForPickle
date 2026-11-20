// A day cell as a checklist: one line = one task due that day.
import type { Task } from "../model";

/** A line being edited in a cell. */
export interface Draft {
  id: string;
  title: string;
  done: boolean;
  color?: string;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const rank = (t: Task) => (t.status === "done" ? 1 : 0);

/** That day's live tasks in display order: open before done, then order, then unordered (imported) by title. */
export function dayList(tasks: Task[], day: string): Task[] {
  return tasks
    .filter((t) => !t.deleted && t.due === day)
    .sort((a, b) => rank(a) - rank(b) || (a.order ?? Infinity) - (b.order ?? Infinity) || cmp(a.title, b.title) || cmp(a.id, b.id));
}

/** Tasks to save after editing a cell: drafts become order 0..n-1, blank lines drop, missing originals are deleted. */
export function commitDay(day: string, original: Task[], drafts: Draft[]): Task[] {
  const byId = new Map(original.map((t) => [t.id, t]));
  const out: Task[] = [];
  const kept = new Set<string>();
  let order = 0;
  for (const d of drafts) {
    const title = d.title.trim();
    if (!title) continue;
    const prev = byId.get(d.id);
    kept.add(d.id);
    const status = d.done ? "done" : prev && prev.status !== "done" ? prev.status : "todo";
    const next: Task = prev
      ? { ...prev, title, status, order }
      : { id: d.id, title, status, due: day, order, notes: "", updatedAt: "", deleted: false };
    if (d.color) next.color = d.color;
    else delete next.color;
    order++;
    if (!prev || prev.title !== next.title || prev.status !== next.status || prev.order !== next.order || prev.color !== next.color) out.push(next);
  }
  for (const t of original) if (!kept.has(t.id)) out.push({ ...t, deleted: true });
  return out;
}

/** How many of a cell's rows to show, given each row's bottom edge in the list box (ascending).
 *  When they don't all fit, the last row that does gives its place to "+N" (rows share one height). */
export function fitRows(bottoms: number[], avail: number): number {
  const k = bottoms.findIndex((b) => b > avail + 1); // 1px slack: zoom and DPI scaling give fractional edges
  return k < 0 ? bottoms.length : Math.max(k - 1, 0);
}
