import { useState } from "preact/hooks";
import { tr } from "../i18n";
import type { Task } from "../model";
import { Dot } from "./icons";

const RANK = { high: 0, normal: 1, low: 2 };
const NO_DUE = "￿"; // code point compare: undated tasks sort last (localeCompare would not)
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: Task, b: Task) =>
  cmp(a.due ?? NO_DUE, b.due ?? NO_DUE) || RANK[a.priority ?? "normal"] - RANK[b.priority ?? "normal"] || cmp(a.title, b.title);

function meta(t: Task, today: string): { text: string; late: boolean } {
  const bits: string[] = [];
  const late = !!t.due && t.due < today && t.status !== "done";
  if (t.due) bits.push(tr.dueBy(t.due, late));
  if (t.status === "doing") bits.push(tr.doing);
  if (t.priority === "high") bits.push(tr.highPriority);
  if (t.priority === "low") bits.push(tr.lowPriority);
  return { text: bits.join(" · "), late };
}

export function TaskPanel(p: { tasks: Task[]; today: string; onSave: (t: Task) => void; onOpen: (t: Task) => void }) {
  const [title, setTitle] = useState("");
  // Dated tasks live in their day cell (session 7); the panel keeps only the undated ones.
  const live = p.tasks.filter((t) => !t.deleted && !t.due);
  const open = live.filter((t) => t.status !== "done").sort(order);
  const done = live.filter((t) => t.status === "done").sort((a, b) => cmp(b.updatedAt, a.updatedAt));

  const add = (ev: SubmitEvent) => {
    ev.preventDefault();
    if (!title.trim()) return;
    p.onSave({ id: crypto.randomUUID(), title: title.trim(), status: "todo", notes: "", updatedAt: "", deleted: false });
    setTitle("");
  };

  const row = (t: Task) => {
    const m = meta(t, p.today);
    return (
      <li key={t.id} class="task">
        <label class="hit">
          <input type="checkbox" checked={t.status === "done"} aria-label={tr.doneLabel(t.title)}
            onChange={() => p.onSave({ ...t, status: t.status === "done" ? "todo" : "done" })} />
        </label>
        <button type="button" class="task-title" onClick={() => p.onOpen(t)}>
          <Dot color={t.color} />
          <span class={t.status === "done" ? "done" : ""}>{t.title || tr.untitled}</span>
          {m.text && <span class={`meta${m.late ? " late" : ""}`}>{m.text}</span>}
        </button>
      </li>
    );
  };

  return (
    <aside class="tasks" aria-label={tr.memo}>
      <div class="tasks-in">
      <form onSubmit={add} class="field">
        <label for="new-task">{tr.newMemo}</label>
        <input id="new-task" value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder={tr.memoPlaceholder} />
      </form>
      {open.length ? <ul>{open.map(row)}</ul> : <p class="empty">{tr.noTasks}</p>}
      {done.length > 0 && (
        <details>
          <summary>{tr.doneCount(done.length)}</summary>
          <ul>{done.map(row)}</ul>
        </details>
      )}
      </div>
    </aside>
  );
}
