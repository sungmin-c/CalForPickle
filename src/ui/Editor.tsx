import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "preact/hooks";
import { setLang, type Lang } from "../i18n";
import type { Event, Task } from "../model";
import { DayEditor } from "./Calendar";
import type { Draft } from "./dayList";
import type { MemoBox } from "./memoBox";

interface Job { day: string; at: number | "end"; tasks: Task[]; events: Event[]; box: MemoBox; lang: Lang; n: number }

/** The page of the memo window (editor.rs). The pinned calendar sits under the desktop icons and gets only replayed clicks;
 *  this is an ordinary window above them, so typing, caret, double and triple click selection are the real thing.
 *  The calendar sends the day, this sends the lines back when the edit ends. */
export function EditorApp() {
  const [job, setJob] = useState<Job | null>(null);
  const count = useRef(0);
  const shown = useRef(false);
  const lastH = useRef(0);
  useEffect(() => {
    const subs = [
      listen<Omit<Job, "n">>("editor-open", ({ payload }) => {
        setLang(payload.lang);
        shown.current = false;
        lastH.current = 0;
        setJob({ ...payload, n: ++count.current });
      }),
      listen("editor-ping", () => void emitTo("main", "editor-ready")),
    ];
    void emitTo("main", "editor-ready"); // the calendar may have asked before this page was listening: it also pings
    return () => subs.forEach((s) => void s.then((off) => off()));
  }, []);
  if (!job) return null;

  // First size shows the window at its place; later ones (a line added or removed) only resize it.
  const size = (cssHeight: number) => {
    if (cssHeight === lastH.current) return; // a keystroke that doesn't change the height needs no resize
    lastH.current = cssHeight;
    const d = devicePixelRatio, b = job.box, w = Math.round(b.w * d), h = Math.round(cssHeight * d);
    if (shown.current) void invoke("editor_fit", { w, h });
    else {
      shown.current = true;
      void invoke("editor_show", { x: Math.round(b.x * d), y: Math.round(b.y * d), w, h, up: b.up });
    }
  };
  const done = (drafts: Draft[], refocus: boolean) => {
    void emitTo("main", "editor-done", { day: job.day, drafts, refocus });
    setJob(null);
    void invoke("editor_hide");
  };
  return (
    // A press on a checkbox must not take the caret from the text line (same as the in-page popover).
    <div class="editor-win" style={{ "--min-h": `${job.box.minH}px`, "--max-h": `${job.box.maxH}px` }}
      onMouseDown={(x) => !(x.target as HTMLElement).closest("textarea") && x.preventDefault()}>
      <DayEditor key={job.n} day={job.day} tasks={job.tasks} events={job.events} at={job.at} popover windowed
        onSize={size} onOpen={(e) => void emitTo("main", "editor-open-event", e)} onDone={done} />
    </div>
  );
}
