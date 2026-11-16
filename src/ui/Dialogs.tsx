import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Event, Priority, Status, Task } from "../model";
import { describeRule } from "../recur";
import { fromForm, koDate, toForm, type EventForm } from "./dates";
import { Dot } from "./icons";

/** Native modal dialog: the page behind is inert (focus stays inside) and Esc closes it. */
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
    <dialog ref={ref} class="modal" aria-labelledby="modal-title" onClose={() => unmounted.current || p.onClose()}>
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

/** Korean reading under a date input; aria-hidden because the input itself already announces the date. */
const DateKo = (p: { d: string }) => <span class="date-ko" aria-hidden="true">{koDate(p.d)}</span>;

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

export function EventDialog(p: {
  event: Event; isNew: boolean; day?: string; routines: Event[];
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
  const [error, setError] = useState("");
  const set = (k: keyof EventForm) => (e: Input) => setF({ ...f, [k]: e.currentTarget.value });

  const submit = (ev: SubmitEvent) => {
    ev.preventDefault();
    const out = fromForm(f, p.event);
    if (typeof out === "string") return setError(out);
    p.onSave(out);
  };

  return (
    <Modal title={p.isNew ? "새 루틴" : "루틴 편집"} onClose={p.onClose}>
      <form onSubmit={submit}>
        <Field id="ev-title" label="제목">
          <input id="ev-title" value={f.title} onInput={set("title")} autoFocus />
        </Field>
        {p.event.recurrence && (
          <p class="hint">반복: {describeRule(p.event.recurrence, p.event.start)}. 아래 날짜는 첫 회차이며, 바꾸면 모든 회차가 함께 옮겨집니다.</p>
        )}
        <label class="check">
          <input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.currentTarget.checked })} />
          종일
        </label>
        <div class="row">
          <Field id="ev-sd" label="시작 날짜">
            <input id="ev-sd" type="date" value={f.startDate} required
              onInput={(e) => {
                const v = e.currentTarget.value;
                // Moving the start past the end drags the end along.
                setF({ ...f, startDate: v, endDate: f.endDate < v ? v : f.endDate });
              }} />
            <DateKo d={f.startDate} />
          </Field>
          {!f.allDay && (
            <Field id="ev-st" label="시작 시각">
              <input id="ev-st" type="time" value={f.startTime} required onInput={set("startTime")} />
            </Field>
          )}
        </div>
        <div class="row">
          <Field id="ev-ed" label={f.allDay ? "마지막 날짜" : "끝 날짜"}>
            <input id="ev-ed" type="date" value={f.endDate} required onInput={set("endDate")} />
            <DateKo d={f.endDate} />
          </Field>
          {!f.allDay && (
            <Field id="ev-et" label="끝 시각">
              <input id="ev-et" type="time" value={f.endTime} required onInput={set("endTime")} />
            </Field>
          )}
        </div>
        {/* New events are title + date only; editing still shows what Pickle may have written. */}
        {!p.isNew && (
          <>
            <Field id="ev-loc" label="장소">
              <input id="ev-loc" value={f.location} onInput={set("location")} />
            </Field>
            <Field id="ev-notes" label="메모">
              <textarea id="ev-notes" rows={3} value={f.notes} onInput={set("notes")} />
            </Field>
          </>
        )}
        {error && <p class="error" role="alert">{error}</p>}
        {confirmDelete ? (
          <div class="confirm" role="group" aria-labelledby="del-q">
            <p id="del-q">'{p.event.title}' 루틴을 모든 회차와 함께 삭제할까요?</p>
            <div class="actions">
              <button type="button" class="danger" onClick={() => p.onSave({ ...p.event, deleted: true })}>삭제</button>
              <button type="button" ref={cancelRef} onClick={() => setConfirmDelete(false)}>취소</button>
            </div>
          </div>
        ) : (
          <div class="actions">
            {!p.isNew && p.event.recurrence && p.day && (
              <button type="button" class="danger" onClick={() => p.onSave({ ...p.event, exdates: [...new Set([...(p.event.exdates ?? []), p.day!])].sort() })}>
                이번 회차만 삭제
              </button>
            )}
            {!p.isNew && (
              <button type="button" class="danger"
                onClick={() => (p.event.recurrence ? setConfirmDelete(true) : p.onSave({ ...p.event, deleted: true }))}>
                {p.event.recurrence ? "전체 삭제" : "삭제"}
              </button>
            )}
            <button type="button" onClick={p.onClose}>취소</button>
            <button type="submit" class="primary">저장</button>
          </div>
        )}
      </form>
      {p.isNew && (
        <section class="routines" aria-labelledby="rt-h">
          <h3 id="rt-h">반복 루틴 {p.routines.length}개</h3>
          {p.routines.length ? (
            <ul>
              {p.routines.map((e) => (
                <li key={e.id}>
                  <button type="button" class="routine" onClick={() => p.onPick(e)}>
                    <span><Dot color={e.color} />{e.title || "(제목 없음)"}</span>
                    <span class="meta">{describeRule(e.recurrence!, e.start)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p class="note">아직 반복 루틴이 없습니다. 반복은 Pickle에게 "매주 월요일 ..."처럼 부탁해 만들 수 있습니다.</p>
          )}
        </section>
      )}
    </Modal>
  );
}

const STATUS: [Status, string][] = [["todo", "할 일"], ["doing", "진행 중"], ["done", "완료"]];
const PRIORITY: [Priority | "", string][] = [["", "없음"], ["high", "높음"], ["normal", "보통"], ["low", "낮음"]];

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
    <Modal title="할 일 편집" onClose={p.onClose}>
      <form onSubmit={submit}>
        <Field id="tk-title" label="제목">
          <input id="tk-title" value={t.title} onInput={(e) => setT({ ...t, title: e.currentTarget.value })} autoFocus />
        </Field>
        <div class="row">
          <Field id="tk-status" label="상태">
            <select id="tk-status" value={t.status} onChange={(e) => setT({ ...t, status: e.currentTarget.value as Status })}>
              {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field id="tk-pri" label="중요도">
            <select id="tk-pri" value={t.priority ?? ""} onChange={(e) => setOpt("priority", e.currentTarget.value)}>
              {PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field id="tk-due" label="마감일 (비워 두면 없음)">
            <input id="tk-due" type="date" value={t.due ?? ""} onInput={(e) => setOpt("due", e.currentTarget.value)} />
            <DateKo d={t.due ?? ""} />
          </Field>
        </div>
        <Field id="tk-notes" label="메모">
          <textarea id="tk-notes" rows={3} value={t.notes} onInput={(e) => setT({ ...t, notes: e.currentTarget.value })} />
        </Field>
        <div class="actions">
          <button type="button" class="danger" onClick={() => p.onSave({ ...p.task, deleted: true })}>삭제</button>
          <button type="button" onClick={p.onClose}>취소</button>
          <button type="submit" class="primary">저장</button>
        </div>
      </form>
    </Modal>
  );
}
