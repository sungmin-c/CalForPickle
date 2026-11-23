import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { tr } from "../i18n";
import type { Event, Priority, Status, Task } from "../model";
import { describeRule } from "../recur";
import { addMonths, fromForm, longDate, toForm, weekday, type EventForm } from "./dates";
import { Dot } from "./icons";
import { defaultRepeat, formToRule, nextRule, repeatError, ruleToForm, seriesDate, skipsMonths, startDay, startNth, type RepeatForm } from "./repeat";

/** Native modal dialog: the page behind is inert (focus stays inside); Esc or a click on the backdrop closes it.
 *  only closes when press and release both land outside, so a drag out of a text field keeps it open. */
export function Modal(p: { title: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  const unmounted = useRef(false);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const dlg = ref.current!;
    dlg.showModal();
    // Close before refocusing: while the dialog is still modal the page behind is inert and focus() is ignored.
    return () => ((unmounted.current = true), dlg.close(), back?.focus());
  }, []);
  return (
    // The close event from that cleanup arrives later; passing it on would also close a dialog that replaced this one.
    <dialog ref={ref} class="modal" closedby="any" aria-labelledby="modal-title" onClose={() => unmounted.current || p.onClose()}>
      <h2 id="modal-title">{p.title}</h2>
      {p.children}
    </dialog>
  );
}

const Field = (p: { id: string; label: string; children: ComponentChildren }) => (
  <div class="field">
    <label for={p.id}>{p.label}</label>
    {p.children}
  </div>
);

/** Spelled-out date under a date input; aria-hidden because the input itself already announces the date. */
const DateKo = (p: { d: string }) => <span class="date-ko" aria-hidden="true">{longDate(p.d)}</span>;

type Input = { currentTarget: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement };

export function newEvent(day: string): Event {
  return {
    id: crypto.randomUUID(),
    title: "",
    start: day,
    end: day,
    allDay: true,
    location: "",
    notes: "",
    updatedAt: "",
    deleted: false,
  };
}

const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const ORDINALS = [1, 2, 3, 4, 5, -1]; // tr.ordNames order
const FREQS = ["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;

/** The routine dialog's repeat controls. `start` is the series date; every change goes through `onChange` as a whole form. */
function RepeatFields(p: { rep: RepeatForm; start: string; onChange: (r: RepeatForm) => void }) {
  const { rep, start } = p;
  const set = (o: Partial<RepeatForm>) => p.onChange({ ...rep, ...o });
  const num = (k: "interval" | "count") => (e: Input) => set({ [k]: Number((e.currentTarget as HTMLInputElement).value || NaN) });
  const days = rep.days ?? [weekday(start)];
  const [k, w] = rep.nth ?? startNth(start);
  const [before, after] = rep.freq === "NONE" ? ["", ""] : tr.every(rep.freq);
  return (
    <>
      <Field id="rp-freq" label={tr.repeat}>
        <select id="rp-freq" value={rep.freq} onChange={(e) => set({ freq: e.currentTarget.value as RepeatForm["freq"] })}>
          {FREQS.map((f) => <option key={f} value={f}>{tr.freqNames[f]}</option>)}
        </select>
      </Field>
      {rep.freq !== "NONE" && (
        <>
          <label class="every">
            {before}
            <input id="rp-n" type="number" min={1} max={999} required aria-label={tr.interval} value={Number.isNaN(rep.interval) ? "" : rep.interval} onInput={num("interval")} />
            {after}
          </label>
          {rep.freq === "WEEKLY" && (
            <div class="field" role="group" aria-labelledby="rp-days">
              <span id="rp-days" class="legend">{tr.weekdays}</span>
              <div class="chips">
                {MON_FIRST.map((d) => (
                  <button key={d} type="button" aria-pressed={days.includes(d)}
                    onClick={() => set({ days: (days.includes(d) ? days.filter((x) => x !== d) : [...days, d]).sort() })}>{tr.dow[d]}</button>
                ))}
                <button type="button" onClick={() => set({ days: [1, 2, 3, 4, 5] })}>{tr.presetWeekdays}</button>
              </div>
            </div>
          )}
          {rep.freq === "MONTHLY" && (
            <>
              <div class="row">
                <Field id="rp-mode" label={tr.monthModeLabel}>
                  <select id="rp-mode" value={rep.mode} onChange={(e) => set({ mode: e.currentTarget.value as RepeatForm["mode"] })}>
                    {(["date", "nth", "last"] as const).map((m) => <option key={m} value={m}>{tr.monthModes[m]}</option>)}
                  </select>
                </Field>
                {rep.mode === "date" && (
                  <Field id="rp-md" label={tr.monthModes.date}>
                    <select id="rp-md" value={rep.monthDay ?? startDay(start)} onChange={(e) => set({ monthDay: Number(e.currentTarget.value) })}>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{tr.dayOfMonth(d)}</option>)}
                    </select>
                  </Field>
                )}
                {rep.mode === "nth" && (
                  <>
                    <Field id="rp-ord" label={tr.ordinal}>
                      <select id="rp-ord" value={k} onChange={(e) => set({ nth: [Number(e.currentTarget.value), w] })}>
                        {ORDINALS.map((o, i) => <option key={o} value={o}>{tr.ordNames[i]}</option>)}
                      </select>
                    </Field>
                    <Field id="rp-wd" label={tr.weekday}>
                      <select id="rp-wd" value={w} onChange={(e) => set({ nth: [k, Number(e.currentTarget.value)] })}>
                        {MON_FIRST.map((d) => <option key={d} value={d}>{tr.dow[d]}</option>)}
                      </select>
                    </Field>
                  </>
                )}
              </div>
              <div class="chips">
                <span class="legend">{tr.quickPick}</span>
                <button type="button" onClick={() => set({ interval: 3 })}>{tr.presetQuarter}</button>
              </div>
            </>
          )}
          <div class="row">
            <Field id="rp-end" label={tr.endLabel}>
              <select id="rp-end" value={rep.end}
                onChange={(e) => {
                  const end = e.currentTarget.value as RepeatForm["end"];
                  set({ end, until: end === "until" && !rep.until ? addMonths(start, 12) : rep.until });
                }}>
                {(["never", "count", "until"] as const).map((v) => <option key={v} value={v}>{tr.endNames[v]}</option>)}
              </select>
            </Field>
            {rep.end === "count" && (
              <Field id="rp-count" label={tr.countLabel}>
                <input id="rp-count" type="number" min={1} max={100000} required value={Number.isNaN(rep.count) ? "" : rep.count} onInput={num("count")} />
              </Field>
            )}
            {rep.end === "until" && (
              <Field id="rp-until" label={tr.untilLabel}>
                <input id="rp-until" type="date" required value={rep.until} onInput={(e) => set({ until: e.currentTarget.value })} />
                <DateKo d={rep.until} />
              </Field>
            )}
          </div>
          {skipsMonths(rep, start) && <p class="hint">{rep.freq === "YEARLY" ? tr.skipLeap : tr.skipMonthly}</p>}
        </>
      )}
    </>
  );
}

/** Dot colors on offer, in tr.colorNames order. model.ts keeps colors upper-case. */
const SWATCHES = ["#F12424", "#F28C1E", "#E6B800", "#1A7F37", "#1CA9A9", "#2456B8", "#8A4FFF", "#E0489B"];

export function EventDialog(p: {
  event: Event; isNew: boolean; day?: string; routines: Event[]; ended: Set<string>;
  onPick: (e: Event) => void; onSave: (e: Event) => void; onClose: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => void (confirmDelete && cancelRef.current?.focus()), [confirmDelete]);
  // A new all-day event arrives with end == start; show it as a one-day event.
  const [f, setF] = useState<EventForm>(() => {
    const form = toForm(p.event);
    return p.isNew ? { ...form, endDate: form.startDate } : form;
  });
  const [color, setColor] = useState(p.event.color);
  const [error, setError] = useState("");
  const set = (k: keyof EventForm) => (e: Input) => setF({ ...f, [k]: e.currentTarget.value });
  // Repeat form; null = the stored rule is one the form can't draw (shown read-only, saved as written unless replaced).
  const origStart = seriesDate(p.event);
  const [init] = useState(() => (p.event.recurrence ? ruleToForm(p.event.recurrence, origStart) : defaultRepeat()));
  const [rep, setRep] = useState(init);
  const advanced = init === null;
  // The event as the form would save it now: its series date and zone feed the repeat's start-following values and the preview.
  const cur = fromForm(f, p.event);
  const now = typeof cur === "string" ? p.event : cur;
  const start = seriesDate(now);
  const rule = rep && rep.freq !== "NONE" && !repeatError(rep, start) ? formToRule(rep, start) : "";

  const submit = (ev: SubmitEvent) => {
    ev.preventDefault();
    const out = fromForm(f, p.event);
    if (typeof out === "string") return setError(out);
    const bad = rep && repeatError(rep, seriesDate(out));
    if (bad) return setError(bad);
    const next = nextRule(rep, p.event.recurrence, origStart, seriesDate(out));
    if (next) out.recurrence = next;
    else delete out.recurrence;
    if (color) out.color = color;
    else delete out.color;
    p.onSave(out);
  };

  return (
    <Modal title={p.isNew ? tr.newRoutine : tr.editRoutine} onClose={p.onClose}>
      <form onSubmit={submit}>
        <Field id="ev-title" label={tr.title}>
          <input id="ev-title" value={f.title} onInput={set("title")} autoFocus />
        </Field>
        <div class="field" role="group" aria-labelledby="ev-color">
          <span id="ev-color" class="legend">{tr.color}</span>
          <div class="swatches">
            <button type="button" class="swatch none" aria-pressed={!color} aria-label={tr.noColor} title={tr.noColor} onClick={() => setColor(undefined)} />
            {/* A color Pickle wrote that isn't in the palette stays selectable. */}
            {[...(color && !SWATCHES.includes(color) ? [color] : []), ...SWATCHES].map((c) => (
              <button key={c} type="button" class="swatch" style={{ background: c }} aria-pressed={color === c}
                aria-label={tr.colorNames[SWATCHES.indexOf(c)] ?? c} title={tr.colorNames[SWATCHES.indexOf(c)] ?? c} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <label class="check">
          <input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.currentTarget.checked })} />
          {tr.allDay}
        </label>
        <div class="row">
          <Field id="ev-sd" label={tr.startDate}>
            <input id="ev-sd" type="date" value={f.startDate} required
              onInput={(e) => {
                const v = e.currentTarget.value;
                // Moving the start past the end drags the end along.
                setF({ ...f, startDate: v, endDate: f.endDate < v ? v : f.endDate });
              }} />
            <DateKo d={f.startDate} />
          </Field>
          {!f.allDay && (
            <Field id="ev-st" label={tr.startTime}>
              <input id="ev-st" type="time" value={f.startTime} required onInput={set("startTime")} />
            </Field>
          )}
        </div>
        <div class="row">
          <Field id="ev-ed" label={f.allDay ? tr.lastDate : tr.endDate}>
            <input id="ev-ed" type="date" value={f.endDate} required onInput={set("endDate")} />
            <DateKo d={f.endDate} />
          </Field>
          {!f.allDay && (
            <Field id="ev-et" label={tr.endTime}>
              <input id="ev-et" type="time" value={f.endTime} required onInput={set("endTime")} />
            </Field>
          )}
        </div>
        <div class="repeat">
          {rep ? (
            <RepeatFields rep={rep} start={start} onChange={setRep} />
          ) : (
            <>
              <span class="legend">{tr.repeat}</span>
              <p class="hint">{tr.advancedRule(describeRule(p.event.recurrence!, p.event.start, p.event.tz))}</p>
              <button type="button" onClick={() => setRep({ ...defaultRepeat(), freq: "WEEKLY" })}>{tr.replaceRule}</button>
            </>
          )}
          {rep && advanced && <p class="hint">{tr.replaceWarn}</p>}
          {rep?.freq === "NONE" && p.event.recurrence && <p class="hint">{tr.removeRepeat}</p>}
          {/* Live preview: the same sentence the routine list shows. */}
          <p class="hint" aria-live="polite">{rule && tr.repeats(describeRule(rule, now.start, now.tz))}</p>
        </div>
        {/* New events are title + date only; editing still shows what Pickle may have written. */}
        {!p.isNew && (
          <>
            <Field id="ev-loc" label={tr.location}>
              <input id="ev-loc" value={f.location} onInput={set("location")} />
            </Field>
            <Field id="ev-notes" label={tr.notes}>
              <textarea id="ev-notes" rows={3} value={f.notes} onInput={set("notes")} />
            </Field>
          </>
        )}
        {error && <p class="error" role="alert">{error}</p>}
        {confirmDelete ? (
          <div class="confirm" role="group" aria-labelledby="del-q">
            <p id="del-q">{tr.confirmDeleteRoutine(p.event.title)}</p>
            <div class="actions">
              <button type="button" class="danger" onClick={() => p.onSave({ ...p.event, deleted: true })}>{tr.delete}</button>
              <button type="button" ref={cancelRef} onClick={() => setConfirmDelete(false)}>{tr.cancel}</button>
            </div>
          </div>
        ) : (
          <div class="actions">
            {!p.isNew && p.event.recurrence && p.day && (
              <button type="button" class="danger" onClick={() => p.onSave({ ...p.event, exdates: [...new Set([...(p.event.exdates ?? []), p.day!])].sort() })}>
                {tr.deleteOne}
              </button>
            )}
            {!p.isNew && (
              <button type="button" class="danger"
                onClick={() => (p.event.recurrence ? setConfirmDelete(true) : p.onSave({ ...p.event, deleted: true }))}>
                {p.event.recurrence ? tr.deleteAll : tr.delete}
              </button>
            )}
            <button type="button" onClick={p.onClose}>{tr.cancel}</button>
            <button type="submit" class="primary">{tr.save}</button>
          </div>
        )}
      </form>
      {p.isNew && (
        <section class="routines" aria-labelledby="rt-h">
          <h3 id="rt-h">{tr.routines(p.routines.length)}</h3>
          {p.routines.length ? (
            <ul>
              {p.routines.map((e) => (
                <li key={e.id}>
                  <button type="button" class="routine" onClick={() => p.onPick(e)}>
                    <span><Dot color={e.color} />{e.title || tr.untitled}</span>
                    <span class="meta">{p.ended.has(e.id) && tr.ended}{describeRule(e.recurrence!, e.start, e.tz)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p class="note">{tr.noRoutines}</p>
          )}
        </section>
      )}
    </Modal>
  );
}

const STATUS: Status[] = ["todo", "doing", "done"];
const PRIORITY: (Priority | "")[] = ["", "high", "normal", "low"];

export function TaskDialog(p: { task: Task; onSave: (t: Task) => void; onClose: () => void }) {
  const [t, setT] = useState<Task>(p.task);
  const submit = (ev: SubmitEvent) => {
    ev.preventDefault();
    p.onSave({ ...t, title: t.title.trim() });
  };
  // Optional fields are dropped (not set to "") when cleared, matching the on-disk schema.
  const setOpt = (k: "due" | "priority", v: string) => {
    const next = { ...t } as Record<string, unknown>;
    if (v) next[k] = v;
    else delete next[k];
    setT(next as unknown as Task);
  };

  return (
    <Modal title={tr.editTask} onClose={p.onClose}>
      <form onSubmit={submit}>
        <Field id="tk-title" label={tr.title}>
          <input id="tk-title" value={t.title} onInput={(e) => setT({ ...t, title: e.currentTarget.value })} autoFocus />
        </Field>
        <div class="row">
          <Field id="tk-status" label={tr.status}>
            <select id="tk-status" value={t.status} onChange={(e) => setT({ ...t, status: e.currentTarget.value as Status })}>
              {STATUS.map((v) => <option key={v} value={v}>{tr.statusNames[v]}</option>)}
            </select>
          </Field>
          <Field id="tk-pri" label={tr.priority}>
            <select id="tk-pri" value={t.priority ?? ""} onChange={(e) => setOpt("priority", e.currentTarget.value)}>
              {PRIORITY.map((v) => <option key={v} value={v}>{tr.priorityNames[v]}</option>)}
            </select>
          </Field>
          <Field id="tk-due" label={tr.due}>
            <input id="tk-due" type="date" value={t.due ?? ""} onInput={(e) => setOpt("due", e.currentTarget.value)} />
            <DateKo d={t.due ?? ""} />
          </Field>
        </div>
        <Field id="tk-notes" label={tr.notes}>
          <textarea id="tk-notes" rows={3} value={t.notes} onInput={(e) => setT({ ...t, notes: e.currentTarget.value })} />
        </Field>
        <div class="actions">
          <button type="button" class="danger" onClick={() => p.onSave({ ...p.task, deleted: true })}>{tr.delete}</button>
          <button type="button" onClick={p.onClose}>{tr.cancel}</button>
          <button type="submit" class="primary">{tr.save}</button>
        </div>
      </form>
    </Modal>
  );
}
