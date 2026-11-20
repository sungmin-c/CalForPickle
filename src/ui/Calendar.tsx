import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Event, Task } from "../model";
import { holidayName, usHolidayName } from "../holidays";
import { lang, tr, type Title } from "../i18n";
import { expand } from "../recur";
import { addDays, addMonths, byTime, monthDays, onDay, timeLabel, weekDays } from "./dates";
import { commitDay, dayList, fitRows, type Draft } from "./dayList";
import { Modal, SWATCHES } from "./Dialogs";
import { Dot } from "./icons";

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
            edit && p.popover && "pop", i % 7 === 0 && "c0", i % 7 >= 5 && "east", i % 7 === 6 && "c6", rows > 2 && i >= days.length - 14 && "south",
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
            <li key={`t:${t.id}`} data-i={i} class={t.status === "done" ? "line done" : "line"}>
              {/* Handlers on the label: a click on its padding must not reach the cell's double-click either. */}
              <label class="hit" onClick={(x) => x.stopPropagation()} onDblClick={(x) => x.stopPropagation()}>
                <input type="checkbox" tabIndex={tab} checked={t.status === "done"} aria-label={tr.doneLabel(t.title)}
                  onChange={() => p.onSaveTasks([{ ...t, status: t.status === "done" ? "todo" : "done" }])} />
              </label>
              <Dot color={t.color} />
              <span>{t.title}</span>
            </li>
          ))];
          const n = fit?.[d] ?? items.length;
          const label = tr.dayLabel(d, d === p.today, holiday, list.length, lines.length);
          return (
            // Single click does nothing; double click opens the memo. Enter on the day button is the keyboard equivalent.
            <div key={d} class={cls.filter(Boolean).join(" ")}
              // Popover: clicks in the memo must not pull focus out of the lines (that would end the edit).
              // A checkbox click must not take the caret from the text line either.
              onMouseDown={(x) => edit && p.popover && !(x.target as HTMLElement).closest("input[type=text]") && x.preventDefault()}
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
              {edit && (
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
function DayEditor(p: { day: string; tasks: Task[]; events: Event[]; at: number | "end"; popover: boolean; onOpen: (e: Event) => void; onDone: (d: Draft[], refocusDay: boolean) => void }) {
  const blank = (): Draft => ({ id: crypto.randomUUID(), title: "", done: false });
  const [rows, setRows] = useState<Draft[]>(() => {
    const r = p.tasks.map((t) => ({ id: t.id, title: t.title, done: t.status === "done", color: t.color }));
    return p.at === "end" || !r.length ? [...r, blank()] : r;
  });
  const box = useRef<HTMLUListElement>(null);
  const want = useRef<number | null>(p.at === "end" ? rows.length - 1 : Math.min(p.at, rows.length - 1));
  const closed = useRef(false); // Esc refocuses the day button, which fires focusout: end the edit once
  const latest = useRef(rows);
  latest.current = rows;

  const [picking, setPicking] = useState<string | null>(null); // id of the line whose color swatches are open
  const memo = useRef<HTMLDivElement>(null);
  // Popover: it ends only on Esc, Tab or a press outside it. Not on focus leaving the lines: a pinned window loses focus to
  // explorer on every click inside it (desktop.rs hands it back on release), and that blur used to close the popover.
  useEffect(() => {
    if (!p.popover) return;
    const out = (ev: MouseEvent) => memo.current && !memo.current.contains(ev.target as Node) && finish(false);
    document.addEventListener("mousedown", out, true);
    return () => document.removeEventListener("mousedown", out, true);
  }); // every render: finish must see the current tasks

  const input = (i: number) => box.current?.querySelectorAll<HTMLInputElement>("input[type=text]")[i];
  const place = () => {
    if (want.current === null) return;
    const el = input(want.current);
    want.current = null;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  };
  // New lines take focus before paint, or fast typing lands in the old line. The dialog opens in Modal's effect, so the
  // first focus waits for that (focus() on a closed dialog is ignored).
  useLayoutEffect(() => {
    const dlg = box.current?.closest("dialog");
    if (!dlg || dlg.open) place();
  }, [rows]);
  useEffect(place, []);

  const finish = (refocusDay: boolean) => {
    if (closed.current) return;
    closed.current = true;
    p.onDone(latest.current, refocusDay);
  };
  const put = (next: Draft[], focus: number) => ((want.current = focus), setRows(next));
  const patch = (i: number, d: Partial<Draft>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...d } : x)));
  // Move focus to the line first: removing the focused swatch fires focusout, which would end the edit.
  const choose = (i: number, color?: string) => (input(i)?.focus(), patch(i, { color }), setPicking(null));

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
      <ul class="lines editing" ref={box}
        onFocusOut={(ev) => !p.popover && !box.current?.contains(ev.relatedTarget as Node | null) && finish(false)}>
        {rows.map((r, i) => (
          <Fragment key={r.id}>
            <li class={r.done ? "done" : undefined}>
              <label class="hit">
                <input type="checkbox" tabIndex={-1} checked={r.done} aria-label={tr.doneLabel(r.title || tr.blankLine)}
                  onChange={() => patch(i, { done: !r.done })} />
              </label>
              <button type="button" class="pick" tabIndex={-1} aria-label={tr.color} aria-expanded={picking === r.id}
                onClick={() => setPicking(picking === r.id ? null : r.id)}>
                <i class={r.color ? "dot" : "dot none"} style={r.color ? { background: r.color } : undefined} />
              </button>
              <input type="text" value={r.title} aria-label={tr.lineLabel(p.day, i + 1)}
                onInput={(ev) => patch(i, { title: ev.currentTarget.value })}
                onKeyDown={(ev) => onKey(ev, i)} onPaste={(ev) => onPaste(ev, i)} />
            </li>
            {picking === r.id && (
              <li class="swatch-row">
                <div class="swatches">
                  <button type="button" class="swatch none" tabIndex={-1} aria-pressed={!r.color} aria-label={tr.noColor} title={tr.noColor}
                    onClick={() => choose(i)} />
                  {[...(r.color && !SWATCHES.includes(r.color) ? [r.color] : []), ...SWATCHES].map((c) => (
                    <button key={c} type="button" class="swatch" tabIndex={-1} style={{ background: c }} aria-pressed={r.color === c}
                      aria-label={tr.colorNames[SWATCHES.indexOf(c)] ?? c} title={tr.colorNames[SWATCHES.indexOf(c)] ?? c}
                      onClick={() => choose(i, c)} />
                  ))}
                </div>
              </li>
            )}
          </Fragment>
        ))}
      </ul>
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
