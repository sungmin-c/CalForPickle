import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Event, Task } from "../model";
import { expand } from "../recur";
import { addDays, addMonths, byTime, monthDays, onDay, timeLabel, weekday, weekDays } from "./dates";
import { commitDay, dayList, fitRows, type Draft } from "./dayList";
import { Dot } from "./icons";

export type View = "month" | "week";
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`;

export function calendarTitle(view: View, sel: string): string {
  const year = `${sel.slice(0, 4)}년`;
  if (view === "month") return `${year} ${Number(sel.slice(5, 7))}월`;
  const [a, b] = [weekDays(sel)[0], weekDays(sel)[6]];
  return `${a.slice(0, 4)}년 ${md(a)} ~ ${a.slice(5, 7) === b.slice(5, 7) ? `${Number(b.slice(8))}일` : md(b)}`;
}

/** Week title for a narrow header: "11.15 – 21", or "11.30 – 12.6" when the week crosses a month. */
export function weekShortTitle(sel: string): string {
  const [a, b] = [weekDays(sel)[0], weekDays(sel)[6]];
  const dot = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8))}`;
  return `${dot(a)} – ${a.slice(5, 7) === b.slice(5, 7) ? Number(b.slice(8)) : dot(b)}`;
}

/** Step for the prev/next buttons and PageUp/PageDown. */
export const shift = (view: View, d: string, n: number) => (view === "month" ? addMonths(d, n) : addDays(d, 7 * n));

export function Calendar(p: {
  view: View;
  sel: string;
  today: string;
  events: Event[];
  tasks: Task[];
  onSelect: (d: string) => void;
  onSaveTasks: (t: Task[]) => void;
  onOpen: (e: Event) => void;
}) {
  const days = p.view === "month" ? monthDays(p.sel) : weekDays(p.sel);
  const month = p.sel.slice(0, 7);
  const shownEvents = expand(p.events, days[0], addDays(days[days.length - 1], 1));
  const refocus = useRef(false);
  // The cell being edited and which line gets the caret ("end" = a new blank line at the bottom).
  const [editing, setEditing] = useState<{ day: string; at: number | "end" } | null>(null);

  // Rows shown per cell. null = render every row, measure them in the layout effect, then cut (before paint).
  const grid = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Record<string, number> | null>(null);
  useLayoutEffect(() => setFit(null), [p.events, p.tasks, p.view, days[0]]);
  useLayoutEffect(() => {
    if (fit) return;
    const next: Record<string, number> = {};
    grid.current?.querySelectorAll<HTMLElement>(".items").forEach((ul) => {
      const top = ul.getBoundingClientRect().top;
      next[ul.dataset.items!] = fitRows([...ul.children].map((li) => li.getBoundingClientRect().bottom - top), ul.clientHeight);
    });
    setFit(next);
  });
  useEffect(() => {
    const ro = new ResizeObserver(() => setFit(null));
    ro.observe(grid.current!);
    return () => ro.disconnect();
  }, []);

  // Keyboard moves the selection; focus follows it right after render (roving tabindex).
  // Layout effect, not effect: with key repeat the next keydown must already land on the new day.
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    document.querySelector<HTMLElement>(`[data-day="${p.sel}"]`)?.focus();
  }, [p.sel, p.view]);

  const onKey = (ev: KeyboardEvent, d: string) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string | undefined;
    if (ev.key in steps) next = addDays(d, steps[ev.key]);
    else if (ev.key === "PageUp") next = shift(p.view, d, -1);
    else if (ev.key === "PageDown") next = shift(p.view, d, 1);
    else if (ev.key === "Home") next = p.today;
    else if (ev.key === "Enter") {
      ev.preventDefault();
      setEditing({ day: d, at: "end" });
      return;
    }
    if (!next) return;
    ev.preventDefault();
    refocus.current = true;
    p.onSelect(next);
  };

  return (
    <section class={`cal ${p.view}`} aria-label={`달력, ${calendarTitle(p.view, p.sel)}`}>
      <div class="dow" aria-hidden="true">
        {DOW.map((d, i) => <span key={d} class={i === 0 ? "sun" : i === 6 ? "sat" : undefined}>{d}</span>)}
      </div>
      <div class="grid" ref={grid}>
        {days.map((d, i) => {
          const list = shownEvents.filter((e) => onDay(e, d)).sort(byTime);
          const active = d === p.sel;
          const tab = active ? 0 : -1;
          const lines = dayList(p.tasks, d);
          const edit = editing?.day === d ? editing : null;
          // The memo grows away from the calendar's edges: right columns open leftward, bottom rows open upward.
          const rows = days.length / 7;
          const cls = ["cell", active && "sel", d === p.today && "today", p.view === "month" && d.slice(0, 7) !== month && "out",
            edit && "pop", i % 7 === 0 && "c0", i % 7 >= 5 && "east", i % 7 === 6 && "c6", rows > 2 && i >= days.length - 14 && "south",
            i >= days.length - 7 && "last"];
          const chip = (e: Event, t: number) => (
            <li key={`${e.id}:${e.start}`}>
              <button type="button" class={`chip${e.allDay ? " all" : ""}`} tabIndex={t}
                onClick={(x) => (x.stopPropagation(), p.onOpen(e))} onDblClick={(x) => x.stopPropagation()}>
                <Dot color={e.color} />
                {!e.allDay && <time>{timeLabel(e)}</time>}
                {e.title || "(제목 없음)"}
              </button>
            </li>
          );
          const open = () => (p.onSelect(d), setEditing({ day: d, at: "end" }));
          // Events, then tasks (open before done): what doesn't fit is cut from the end, so done tasks go first.
          const items = [...list.map((e) => chip(e, tab)), ...lines.map((t, i) => (
            <li key={`t:${t.id}`} data-i={i} class={t.status === "done" ? "line done" : "line"}>
              <input type="checkbox" tabIndex={tab} checked={t.status === "done"} aria-label={`${t.title || "제목 없음"} 완료`}
                onClick={(x) => x.stopPropagation()} onDblClick={(x) => x.stopPropagation()}
                onChange={() => p.onSaveTasks([{ ...t, status: t.status === "done" ? "todo" : "done" }])} />
              <Dot color={t.color} />
              <span>{t.title}</span>
            </li>
          ))];
          const n = fit?.[d] ?? items.length;
          const label = `${md(d)} ${DOW[weekday(d)]}요일${d === p.today ? ", 오늘" : ""}, 일정 ${list.length ? `${list.length}개` : "없음"}${lines.length ? `, 할 일 ${lines.length}개` : ""}`;
          return (
            // Single click does nothing (session 9); double click opens the memo. Enter on the day button is the keyboard equivalent.
            <div key={d} class={cls.filter(Boolean).join(" ")}
              // While editing, clicks in the memo must not pull focus out of the lines (that would end the edit).
              onMouseDown={(x) => edit && !(x.target as HTMLElement).closest("input") && x.preventDefault()}
              onDblClick={(x) => {
                if (edit || (p.view === "month" && d.slice(0, 7) !== month)) return; // a greyed day of another month must not switch the month
                p.onSelect(d);
                const li = (x.target as HTMLElement).closest<HTMLElement>("[data-i]");
                setEditing({ day: d, at: li ? Number(li.dataset.i) : "end" });
              }}>
              <button type="button" class="day" data-day={d} tabIndex={tab} aria-label={label}
                aria-current={d === p.today ? "date" : undefined} onKeyDown={(e) => onKey(e, d)}>
                {p.view === "week" ? `${Number(d.slice(8))} ${DOW[weekday(d)]}` : Number(d.slice(8))}
              </button>
              <ul class="items" data-items={d}>
                {items.slice(0, n)}
                {n < items.length && (
                  <li>
                    <button type="button" class="more" tabIndex={tab} aria-label={`${md(d)} 일정·할 일 ${items.length - n}개 더 보기 (메모 열기)`}
                      onClick={(x) => (x.stopPropagation(), open())} onDblClick={(x) => x.stopPropagation()}>
                      +{items.length - n}개
                    </button>
                  </li>
                )}
              </ul>
              {edit && (
                // Not a dialog: the rest of the calendar stays live, and leaving the memo saves it like leaving the lines did.
                <div class="memo">
                  <p class="memo-day" aria-hidden="true">{md(d)} {DOW[weekday(d)]}요일</p>
                  {list.length > 0 && <ul>{list.map((e) => chip(e, -1))}</ul>}
                  <DayEditor key={d} day={d} tasks={lines} at={edit.at}
                    onDone={(drafts, refocusDay) => {
                      setEditing(null);
                      const changed = commitDay(d, lines, drafts);
                      if (changed.length) p.onSaveTasks(changed);
                      if (refocusDay) document.querySelector<HTMLElement>(`[data-day="${d}"]`)?.focus();
                    }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** One input per line, bound to the task id, so an edit never has to guess which task a line was. Ends on Esc, Tab or focus leaving the lines. */
function DayEditor(p: { day: string; tasks: Task[]; at: number | "end"; onDone: (d: Draft[], refocusDay: boolean) => void }) {
  const blank = (): Draft => ({ id: crypto.randomUUID(), title: "", done: false });
  const [rows, setRows] = useState<Draft[]>(() => {
    const r = p.tasks.map((t) => ({ id: t.id, title: t.title, done: t.status === "done" }));
    return p.at === "end" || !r.length ? [...r, blank()] : r;
  });
  const box = useRef<HTMLUListElement>(null);
  const want = useRef<number | null>(p.at === "end" ? rows.length - 1 : Math.min(p.at, rows.length - 1));
  const closed = useRef(false); // Esc refocuses the day button, which fires focusout: end the edit once
  const latest = useRef(rows);
  latest.current = rows;

  const input = (i: number) => box.current?.querySelectorAll<HTMLInputElement>("input[type=text]")[i];
  useLayoutEffect(() => {
    if (want.current === null) return;
    const el = input(want.current);
    want.current = null;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [rows]);

  const finish = (refocusDay: boolean) => {
    if (closed.current) return;
    closed.current = true;
    p.onDone(latest.current, refocusDay);
  };
  const put = (next: Draft[], focus: number) => ((want.current = focus), setRows(next));
  const patch = (i: number, d: Partial<Draft>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...d } : x)));

  const onKey = (ev: KeyboardEvent, i: number) => {
    if (ev.isComposing) return; // Korean IME: Enter/Backspace while composing belong to the IME
    const el = ev.currentTarget as HTMLInputElement;
    if (ev.key === "Enter") {
      ev.preventDefault();
      put([...rows.slice(0, i + 1), blank(), ...rows.slice(i + 1)], i + 1);
    } else if (ev.key === "Backspace" && el.value === "" && rows.length > 1) {
      ev.preventDefault();
      // Move focus first: removing the focused input fires focusout, which would end the edit.
      input(i > 0 ? i - 1 : 1)?.focus();
      put(rows.filter((_, j) => j !== i), Math.max(i - 1, 0));
    } else if (ev.key === "ArrowUp" && i > 0) {
      ev.preventDefault();
      input(i - 1)?.focus();
    } else if (ev.key === "ArrowDown" && i < rows.length - 1) {
      ev.preventDefault();
      input(i + 1)?.focus();
    } else if (ev.key === "Escape" || ev.key === "Tab") {
      ev.preventDefault();
      finish(true);
    }
  };

  // A pasted multi-line list becomes one row per line.
  const onPaste = (ev: ClipboardEvent, i: number) => {
    const text = ev.clipboardData?.getData("text") ?? "";
    if (!/[\r\n]/.test(text)) return;
    ev.preventDefault();
    const el = ev.currentTarget as HTMLInputElement;
    const parts = text.split(/\r\n|\n|\r/);
    const head = el.value.slice(0, el.selectionStart ?? el.value.length);
    const tail = el.value.slice(el.selectionEnd ?? el.value.length);
    const added = parts.map((t, j) => ({
      ...(j === 0 ? rows[i] : blank()),
      title: (j === 0 ? head : "") + t + (j === parts.length - 1 ? tail : ""),
    }));
    put([...rows.slice(0, i), ...added, ...rows.slice(i + 1)], i + parts.length - 1);
  };

  return (
    <ul class="lines editing" ref={box}
      onFocusOut={(ev) => !box.current?.contains(ev.relatedTarget as Node | null) && finish(false)}>
      {rows.map((r, i) => (
        <li key={r.id} class={r.done ? "done" : undefined}>
          <input type="checkbox" tabIndex={-1} checked={r.done} aria-label={`${r.title || "빈 줄"} 완료`}
            onChange={() => patch(i, { done: !r.done })} />
          <input type="text" value={r.title} aria-label={`${md(p.day)} 할 일 ${i + 1}번째 줄`}
            onInput={(ev) => patch(i, { title: ev.currentTarget.value })}
            onKeyDown={(ev) => onKey(ev, i)} onPaste={(ev) => onPaste(ev, i)} />
        </li>
      ))}
    </ul>
  );
}
