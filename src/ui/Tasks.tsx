import { useState } from "preact/hooks";
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
  if (t.due) bits.push(`${Number(t.due.slice(5, 7))}월 ${Number(t.due.slice(8))}일까지${late ? " (지남)" : ""}`);
  if (t.status === "doing") bits.push("진행 중");
  if (t.priority === "high") bits.push("중요도 높음");
  if (t.priority === "low") bits.push("중요도 낮음");
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
        <input type="checkbox" checked={t.status === "done"} aria-label={`${t.title || "제목 없음"} 완료`}
          onChange={() => p.onSave({ ...t, status: t.status === "done" ? "todo" : "done" })} />
        <button type="button" class="task-title" onClick={() => p.onOpen(t)}>
          <Dot color={t.color} />
          <span class={t.status === "done" ? "done" : ""}>{t.title || "(제목 없음)"}</span>
          {m.text && <span class={`meta${m.late ? " late" : ""}`}>{m.text}</span>}
        </button>
      </li>
    );
  };

  return (
    <aside class="tasks" aria-label="할 일">
      <form onSubmit={add} class="field">
        <label for="new-task">새 할 일</label>
        <input id="new-task" value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="적고 Enter" />
      </form>
      {open.length ? <ul>{open.map(row)}</ul> : <p class="empty">남은 할 일이 없습니다.</p>}
      {done.length > 0 && (
        <details>
          <summary>완료 {done.length}개</summary>
          <ul>{done.map(row)}</ul>
        </details>
      )}
    </aside>
  );
}
