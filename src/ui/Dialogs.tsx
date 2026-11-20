import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { tr } from "../i18n";
import type { Event, Priority, Status, Task } from "../model";
import { describeRule } from "../recur";
import { fromForm, longDate, toForm, type EventForm } from "./dates";
import { Dot } from "./icons";

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

/** Dot colors on offer, in tr.colorNames order. model.ts keeps colors upper-case. */
export const SWATCHES =["#F12424", "#F28C1E", "#E6B800", "#1A7F37", "#1CA9A9", "#2456B8", "#8A4FFF", "#E0489B"];

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

  const submit = (ev: SubmitEvent) => {
    ev.preventDefault();
    const out = fromForm(f, p.event);
    if (typeof out === "string") return setError(out);
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
        {p.event.recurrence && (
          <p class="hint">{tr.repeats(describeRule(p.event.recurrence, p.event.start, p.event.tz))}</p>
        )}
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
