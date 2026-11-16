import type { Event, Task } from "../src/model";

export const ev = (o: Partial<Event> & { id: string }): Event => ({
  title: "t",
  start: "2026-11-20T14:00:00+09:00",
  end: "2026-11-20T15:00:00+09:00",
  allDay: false,
  location: "",
  notes: "",
  updatedAt: "2026-11-15T10:00:00.000+09:00",
  deleted: false,
  ...o,
});

export const task = (o: Partial<Task> & { id: string }): Task => ({
  title: "t",
  status: "todo",
  notes: "",
  updatedAt: "2026-11-15T10:00:00.000+09:00",
  deleted: false,
  ...o,
});
