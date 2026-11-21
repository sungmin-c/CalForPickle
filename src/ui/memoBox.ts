export interface Rect { left: number; top: number; right: number; bottom: number }
/** The memo window in main-window px: x is the left edge, y the top edge (the bottom edge when `up`). */
export interface MemoBox { x: number; y: number; w: number; minH: number; maxH: number; up: boolean }

/** Where a day's memo hangs around its cell. The same rules as the in-page popover (.memo in app.css):
 *  right columns open leftward, the bottom two month rows open upward, a week cell stays inside its own height. */
export function memoBox(c: Rect, o: { col: number; south: boolean; last: boolean; week: boolean; vh: number }): MemoBox {
  const cw = c.right - c.left, ch = c.bottom - c.top;
  const w = Math.max(cw + 12, 240);
  const east = o.col >= 5;
  const right = c.right + (o.col === 6 ? 0 : 6);
  const x = east ? right - w : c.left - (o.col === 0 ? 0 : 6);
  if (o.week) return { x, y: c.top, w, minH: 0, maxH: ch, up: false };
  const minH = ch + 12, maxH = Math.max(Math.min(o.vh * 0.6, 420), minH);
  return o.south ? { x, y: c.bottom + (o.last ? 0 : 6), w, minH, maxH, up: true } : { x, y: c.top - 6, w, minH, maxH, up: false };
}
