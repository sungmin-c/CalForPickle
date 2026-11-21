// A day cell as a checklist: one line = one task due that day.
import type { Task } from "../model";

/** A line being edited in a cell. */
export interface Draft {
  id: string;
  title: string;
  done: boolean;
}

/** The day's lines are edited as one text. Give each line of the edited text its task back: lines that are unchanged at the
 *  start and at the end keep theirs, the changed block in between reuses the old ids in order (a new line gets a fresh id,
 *  a surplus old one is dropped). So a line that only moved down (Enter before it) keeps its id and done flag. */
export function reflow(old: Draft[], lines: string[], blank: () => Draft): Draft[] {
  let a = 0;
  while (a < old.length && a < lines.length && old[a].title === lines[a]) a++;
  let b = 0;
  while (b < old.length - a && b < lines.length - a && old[old.length - 1 - b].title === lines[lines.length - 1 - b]) b++;
  const was = old.slice(a, old.length - b);
  const mid = lines.slice(a, lines.length - b).map((title, k) => (was[k] ? { ...was[k], title } : { ...blank(), title }));
  return [...old.slice(0, a), ...mid, ...old.slice(old.length - b)];
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
    order++;
    if (!prev || prev.title !== next.title || prev.status !== next.status || prev.order !== next.order) out.push(next);
  }
  for (const t of original) if (!kept.has(t.id)) out.push({ ...t, deleted: true });
  return out;
}

/** How many of a cell's rows to show, given each row's bottom edge in the list box (ascending).
 *  When they don't all fit, the rows left of the "+N" row (`more` px tall with its gap) are the ones that still leave room for it.
 *  A first row taller than the whole cell (a long task, wrapped) is shown anyway, clipped, rather than only "+N". */
export function fitRows(bottoms: number[], avail: number, more = 24): number {
  const k = bottoms.findIndex((b) => b > avail + 1); // 1px slack: zoom and DPI scaling give fractional edges
  if (k < 0) return bottoms.length;
  if (k === 0) return 1;
  let m = k;
  while (m > 0 && bottoms[m - 1] + more > avail + 1) m--;
  return m;
}

/** Lines a task may show when it alone is taller than its cell: whole lines only (the rest ends in "…"),
 *  leaving `more` px for "+N" when other rows are hidden. 2px is the span's vertical padding. */
export function clampLines(avail: number, lineHeight: number, more: number): number {
  return Math.max(1, Math.floor((avail - more - 2) / lineHeight));
}
