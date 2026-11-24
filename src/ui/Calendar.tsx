import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Event, Task } from "../model";
import { holidayName, usHolidayName } from "../holidays";
import { lang, tr, type Title } from "../i18n";
import { expand } from "../recur";
import { addDays, addMonths, byTime, monthDays, onDay, timeLabel, weekDays } from "./dates";
import { clampLines, commitDay, dayList, fitRows, reflow, type Draft } from "./dayList";
import { Modal } from "./Dialogs";
import { Dot } from "./icons";
import { memoBox } from "./memoBox";

export type View = "month" | "week";
/** Header title in parts; `short` is the narrow-header form ("11.15 – 21", English also "Nov 2026"). */
export function calendarTitle(view: View, sel: string): Title {
  return view === "month" ? tr.monthTitle(sel) : tr.weekTitle(weekDays(sel)[0], weekDays(sel)[6]);
}

export const titleText = (t: Title) => (tr.yearFirst ? t.year + t.main : t.main + t.year);

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
  onEditing: (on: boolean) => void;
  /** Edit a day in a popover over its cell instead of a dialog. */
  popover: boolean;
  /** Pinned under the icons: the memo is its own window above them (editor.rs, Editor.tsx) instead of part of this page. */
  editorWin: boolean;
}) {
  const days = p.view === "month" ? monthDays(p.sel) : weekDays(p.sel);
  const month = p.sel.slice(0, 7);
  // One broken event must not blank the whole calendar: skip it and say which.
  const shownEvents = p.events.flatMap((e) => {
    try {
      return expand([e], days[0], addDays(days[days.length - 1], 1));
    } catch (err) {
      console.warn(`skipped event ${e.id}`, err);
      return [];
    }
  });
  const refocus = useRef(false);
  // The cell being edited and which line gets the caret ("end" = a new blank line at the bottom).
  const [editing, setEditing] = useState<{ day: string; at: number | "end" } | null>(null);
  // Only the dialog needs the window above the icons; raising it for the popover would hide every icon behind the calendar.
  useEffect(() => p.onEditing(editing !== null && !p.popover), [editing !== null, p.popover]);
  // A greyed day of another month can be edited, but must not switch the month, so it is not selected.
  const pick = (d: string) => p.view === "month" && d.slice(0, 7) !== month || p.onSelect(d);

  // Memo window: this page hands the day over and takes the lines back when the window ends the edit.
  const latest = useRef(p);
  latest.current = p;
  useEffect(() => {
    if (!p.editorWin || !editing) return;
    const i = days.indexOf(editing.day);
    const cell = grid.current?.querySelector<HTMLElement>(`[data-day="${editing.day}"]`)?.closest(".cell");
    if (i < 0 || !cell) return;
    const rows = days.length / 7;
    const box = memoBox(cell.getBoundingClientRect(), { col: i % 7, south: rows > 2 && i >= days.length - 14, last: i >= days.length - 7, week: p.view === "week", vh: innerHeight });
    const events = shownEvents.filter((e) => onDay(e, editing.day)).sort(byTime);
    void emitTo("editor", "editor-open", { day: editing.day, at: editing.at, tasks: dayList(p.tasks, editing.day), events, box, lang, dpr: devicePixelRatio });
  }, [editing, p.editorWin]);
  useEffect(() => {
    if (!p.editorWin) return;
    const subs = [
      listen<{ day: string; drafts: Draft[]; refocus: boolean }>("editor-done", ({ payload: { day, drafts, refocus } }) => {
        setEditing(null);
        const changed = commitDay(day, dayList(latest.current.tasks, day), drafts);
        if (changed.length) latest.current.onSaveTasks(changed);
        if (refocus) setTimeout(() => document.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus());
      }),
      listen<Event>("editor-open-event", ({ payload }) => latest.current.onOpen(payload)),
    ];
    return () => subs.forEach((s) => void s.then((off) => off()));
  }, [p.editorWin]);

  // Rows shown per cell. null = render every row, measure them in the layout effect, then cut (before paint).
  const grid = useRef<HTMLDivElement>(null);
  // n: rows shown; lines: a first row taller than the whole cell is cut to this many lines.
  const [fit, setFit] = useState<{ n: Record<string, number>; lines: Record<string, number> } | null>(null);
  useLayoutEffect(() => setFit(null), [p.events, p.tasks, p.view, days[0]]);
  useLayoutEffect(() => {
    if (fit) return;
    const next = { n: {} as Record<string, number>, lines: {} as Record<string, number> };
    grid.current?.querySelectorAll<HTMLElement>(".items").forEach((ul) => {
      const top = ul.getBoundingClientRect().top;
      const bottoms = [...ul.children].map((li) => li.getBoundingClientRect().bottom - top);
      const n = (next.n[ul.dataset.items!] = fitRows(bottoms, ul.clientHeight));
      const first = ul.querySelector<HTMLElement>(".line span");
      if (n === 1 && bottoms[0] > ul.clientHeight + 1 && first && ul.firstElementChild?.classList.contains("line"))
        next.lines[ul.dataset.items!] = clampLines(ul.clientHeight, parseFloat(getComputedStyle(first).lineHeight) || 18, bottoms.length > 1 ? 24 : 0);
    });
    setFit(next);
  });
  useEffect(() => {
    // Resizing fires every frame (window drag, the memo panel's 0.2s grid transition): re-measure once it stops.
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => setFit(null), 100);
    });
    ro.observe(grid.current!);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
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
    <section class={`cal ${p.view}`} aria-label={tr.calendar(titleText(calendarTitle(p.view, p.sel)))}>
      <div class="dow" aria-hidden="true">
        {tr.dow.map((d, i) => <span key={d} class={i === 0 ? "sun" : i === 6 ? "sat" : undefined}>{d}</span>)}
      </div>
      <div class="grid" ref={grid}>
        {days.map((d, i) => {
          const list = shownEvents.filter((e) => onDay(e, d)).sort(byTime);
          const active = d === p.sel;
          const tab = active ? 0 : -1;
          const lines = dayList(p.tasks, d);
          const edit = editing?.day === d ? editing : null;
          const holiday = lang === "en" ? usHolidayName(d) : holidayName(d);
          // The popover grows away from the calendar's edges: right columns open leftward, bottom rows open upward.
          const rows = days.length / 7;
          const cls = ["cell", active && "sel", d === p.today && "today", holiday && "hol", p.view === "month" && d.slice(0, 7) !== month && "out",
            edit && p.popover && !p.editorWin && "pop", i % 7 === 0 && "c0", i % 7 >= 5 && "east", i % 7 === 6 && "c6", rows > 2 && i >= days.length - 14 && "south",
            i >= days.length - 7 && "last"];
          const chip = (e: Event, t: number) => (
            <li key={`${e.id}:${e.start}`}>
              <button type="button" class={`chip${e.allDay ? " all" : ""}`} tabIndex={t}
                onClick={(x) => (x.stopPropagation(), p.onOpen(e))} onDblClick={(x) => x.stopPropagation()}>
                <Dot color={e.color} />
                {!e.allDay && <time>{timeLabel(e)}</time>}
                {e.title || tr.untitled}
              </button>
            </li>
          );
          const open = () => (pick(d), setEditing({ day: d, at: "end" }));
          // Events, then tasks (open before done): what doesn't fit is cut from the end, so done tasks go first.
          const items = [...list.map((e) => chip(e, tab)), ...lines.map((t, i) => (
            <li key={`t:${t.id}`} data-i={i} class={t.status === "done" ? "line done" : "line"}
              style={!list.length && i === 0 && fit?.lines[d] ? { "--lines": fit.lines[d] } : undefined}>
              {/* Handlers on the label: a click on its padding must not reach the cell's double-click either. */}
              <label class="hit" onClick={(x) => x.stopPropagation()} onDblClick={(x) => x.stopPropagation()}>
                <input type="checkbox" tabIndex={tab} checked={t.status === "done"} aria-label={tr.doneLabel(t.title)}
                  onChange={() => p.onSaveTasks([{ ...t, status: t.status === "done" ? "todo" : "done" }])} />
              </label>
              <Dot color={t.color} />
              <span>{t.title}</span>
            </li>
          ))];
          const n = fit?.n[d] ?? items.length;
          const label = tr.dayLabel(d, d === p.today, holiday, list.length, lines.length);
          return (
            // Single click does nothing; double click opens the memo. Enter on the day button is the keyboard equivalent.
            <div key={d} class={cls.filter(Boolean).join(" ")}
              // Popover: clicks in the memo must not pull focus out of the lines (that would end the edit).
              // A checkbox click must not take the caret from the text line either.
              onMouseDown={(x) => edit && p.popover && !(x.target as HTMLElement).closest("textarea") && x.preventDefault()}
              onDblClick={(x) => {
                if (edit) return;
                pick(d);
                const li = (x.target as HTMLElement).closest<HTMLElement>("[data-i]");
                setEditing({ day: d, at: li ? Number(li.dataset.i) : "end" });
              }}>
              <div class="dayrow">
                <button type="button" class="day" data-day={d} tabIndex={tab} aria-label={label}
                  aria-current={d === p.today ? "date" : undefined} onKeyDown={(e) => onKey(e, d)}>
                  {p.view === "week" ? tr.weekDay(d) : Number(d.slice(8))}
                </button>
                {holiday && <span class="holiday" aria-hidden="true" title={holiday}>{holiday.replace(/\s*\(.*\)/, "")}</span>}
              </div>
              <ul class="items" data-items={d}>
                {items.slice(0, n)}
                {n < items.length && (
                  <li>
                    <button type="button" class="more" tabIndex={tab} aria-label={tr.moreLabel(d, items.length - n)}
                      onClick={(x) => (x.stopPropagation(), open())} onDblClick={(x) => x.stopPropagation()}>
                      {tr.more(items.length - n)}
                    </button>
                  </li>
                )}
              </ul>
              {edit && !p.editorWin && (
                // Dialog (or popover): it can sit above the desktop icons; leaving it (Esc, Tab, a click outside) saves like leaving the lines did.
                <DayEditor key={d} day={d} tasks={lines} at={edit.at} events={list} popover={p.popover} onOpen={p.onOpen}
                  onDone={(drafts, refocusDay) => {
                    setEditing(null);
                    const changed = commitDay(d, lines, drafts);
                    if (changed.length) p.onSaveTasks(changed);
                    // After the dialog has closed: while it is modal, focus() on the page behind is ignored.
                    if (refocusDay) setTimeout(() => document.querySelector<HTMLElement>(`[data-day="${d}"]`)?.focus());
                  }} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** One input per line, bound to the task id, so an edit never has to guess which task a line was. Ends on Esc, Tab or focus leaving the lines. */
export function DayEditor(p: {
  day: string; tasks: Task[]; events: Event[]; at: number | "end"; popover: boolean; onOpen: (e: Event) => void; onDone: (d: Draft[], refocusDay: boolean) => void;
  /** In its own window (Editor.tsx): there is no "outside" to press, the edit ends when the window loses focus. onSize reports the memo's height. */
  windowed?: boolean; onSize?: (cssHeight: number) => void;
}) {
  const blank = (): Draft => ({ id: crypto.randomUUID(), title: "", done: false });
  const [rows, setRows] = useState<Draft[]>(() => {
    const r = p.tasks.map((t) => ({ id: t.id, title: t.title, done: t.status === "done" }));
    return p.at === "end" || !r.length ? [...r, blank()] : r;
  });
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // Where the caret starts: the end of the clicked line ("end": the new blank line at the bottom).
  const want = useRef<number | null>(null);
  want.current ??= (() => {
    const i = p.at === "end" ? rows.length - 1 : Math.min(p.at, rows.length - 1);
    return rows.slice(0, i + 1).reduce((n, r) => n + r.title.length, 0) + i;
  })();
  const closed = useRef(false); // Esc refocuses the day button, which fires focusout: end the edit once
  const latest = useRef(rows);
  latest.current = rows;

  const memo = useRef<HTMLDivElement>(null);
  // Popover: it ends only on Esc, Tab or a press outside it. Not on focus leaving the lines: a pinned window loses focus to
  // explorer on every click inside it (desktop.rs hands it back on release), and that blur used to close the popover.
  useEffect(() => {
    if (!p.popover) return;
    if (p.windowed) {
      const lost = () => finish(false);
      addEventListener("blur", lost);
      return () => removeEventListener("blur", lost);
    }
    const out = (ev: MouseEvent) => memo.current && !memo.current.contains(ev.target as Node) && finish(false);
    document.addEventListener("mousedown", out, true);
    return () => document.removeEventListener("mousedown", out, true);
  }); // every render: finish must see the current tasks

  const place = () => {
    if (want.current === null) return;
    const at = want.current;
    want.current = null;
    area.current?.focus();
    area.current?.setSelectionRange(at, at);
  };
  // The dialog opens in Modal's effect, so the first focus waits for that (focus() on a closed dialog is ignored).
  useLayoutEffect(() => {
    const dlg = box.current?.closest("dialog");
    if (!dlg || dlg.open) place();
  }, []);
  useEffect(place, []);
  useLayoutEffect(() => {
    if (memo.current) p.onSize?.(memo.current.offsetHeight);
  }, [rows]);

  const finish = (refocusDay: boolean) => {
    if (closed.current) return;
    closed.current = true;
    p.onDone(latest.current, refocusDay);
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.isComposing) return; // Korean IME: its keys belong to the IME
    if (ev.key === "Escape" || ev.key === "Tab") {
      ev.preventDefault();
      finish(true);
    }
  };

  const body = (
    <>
      {p.events.length > 0 && (
        <ul class="day-events">
          {p.events.map((e) => (
            <li key={`${e.id}:${e.start}`}>
              {/* Save the lines, close, then open the routine: two editors must not be open at once. */}
              <button type="button" class="ev-open" onMouseDown={(x) => x.preventDefault()} onClick={() => (finish(false), p.onOpen(e))}>
                <Dot color={e.color} />{!e.allDay && <time>{timeLabel(e)}</time>}{e.title || tr.untitled}
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* All lines are one text, so a drag, copy or delete runs across lines. The invisible list under the text has one item per
          task: it sets the height (it wraps like the text) and carries each line's checkbox. */}
      <div class="lines editing" ref={box}
        onFocusOut={(ev) => !p.popover && !box.current?.contains(ev.relatedTarget as Node | null) && finish(false)}>
        <div class="stack">
          <ul class="mirror">
            {rows.map((r, i) => (
              <li key={r.id} class="txt">
                <label class="hit">
                  <input type="checkbox" tabIndex={-1} checked={r.done} aria-label={tr.doneLabel(r.title || tr.blankLine)}
                    onChange={() => setRows(rows.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
                </label>
                {r.title}
              </li>
            ))}
          </ul>
          <textarea ref={area} class="txt" rows={1} value={rows.map((r) => r.title).join("\n")} aria-label={tr.dayHeading(p.day)}
            onInput={(ev) => {
              const lines = ev.currentTarget.value.split("\n");
              setRows((r) => reflow(r, lines, blank));
            }}
            onKeyDown={onKey} />
        </div>
      </div>
    </>
  );
  return p.popover ? (
    <div class="memo" ref={memo}>
      <p class="memo-day" aria-hidden="true">{tr.dayHeading(p.day)}</p>
      {body}
    </div>
  ) : (
    <Modal title={tr.dayHeading(p.day)} onClose={() => finish(true)}>{body}</Modal>
  );
}
