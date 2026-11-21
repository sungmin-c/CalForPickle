import { describe, expect, it } from "vitest";
import { parseEvents, parseTasks, serializeEvents, serializeTasks } from "../src/model";

describe("6. serialization", () => {
  it("fixed key order, 2-space indent, id order, omitted optional keys, one trailing newline", () => {
    const input = JSON.stringify([
      {
        notes: "",
        id: "b",
        extra: "dropped",
        updatedAt: "2026-11-15T10:00:00.000+09:00",
        status: "done",
        title: "second",
        deleted: false,
      },
      {
        priority: "high",
        due: "2026-11-20",
        title: "first",
        id: "a",
        status: "todo",
        updatedAt: "2026-11-15T10:00:00.000+09:00",
      },
    ]);
    const expected = `[
  {
    "id": "a",
    "title": "first",
    "status": "todo",
    "due": "2026-11-20",
    "priority": "high",
    "notes": "",
    "updatedAt": "2026-11-15T10:00:00.000+09:00",
    "deleted": false
  },
  {
    "id": "b",
    "title": "second",
    "status": "done",
    "notes": "",
    "updatedAt": "2026-11-15T10:00:00.000+09:00",
    "deleted": false
  }
]
`;
    expect(serializeTasks(parseTasks(input))).toBe(expected);
  });

  it("events keep location and allDay, and an empty list is []", () => {
    expect(serializeEvents([])).toBe("[]\n");
    const out = serializeEvents([
      {
        deleted: false,
        allDay: true,
        end: "2026-11-21",
        start: "2026-11-20",
        title: "x",
        id: "e",
        notes: "",
        location: "",
        updatedAt: "2026-11-15T10:00:00.000+09:00",
      },
    ]);
    expect(out).toBe(`[
  {
    "id": "e",
    "title": "x",
    "start": "2026-11-20",
    "end": "2026-11-21",
    "allDay": true,
    "location": "",
    "notes": "",
    "updatedAt": "2026-11-15T10:00:00.000+09:00",
    "deleted": false
  }
]
`);
  });

  it("writes order after priority and rejects a non-integer order", () => {
    const out = serializeTasks(parseTasks(
      '[{"id":"a","title":"x","status":"todo","order":2,"priority":"low","updatedAt":"2026-11-15T10:00:00.000+09:00"}]',
    ));
    expect(out).toContain('"priority": "low",\n    "order": 2,\n    "notes"');
    expect(() => parseTasks('[{"id":"a","order":1.5,"updatedAt":"2026-11-15T10:00:00.000+09:00"}]')).toThrow();
    expect(() => parseTasks('[{"id":"a","order":-1,"updatedAt":"2026-11-15T10:00:00.000+09:00"}]')).toThrow();
  });

  it("events: recurrence and exdates after allDay, exdates sorted and deduped, omitted when absent or empty", () => {
    const base = '"id":"e","start":"2026-11-02","end":"2026-11-03","allDay":true,"updatedAt":"2026-11-15T10:00:00.000+09:00"';
    const out = serializeEvents(parseEvents(`[{${base},"exdates":["2026-11-16","2026-11-09","2026-11-16"],"recurrence":"FREQ=WEEKLY;BYDAY=MO"}]`));
    expect(out).toContain(`"allDay": true,
    "recurrence": "FREQ=WEEKLY;BYDAY=MO",
    "exdates": [
      "2026-11-09",
      "2026-11-16"
    ],
    "location"`);
    expect(serializeEvents(parseEvents(`[{${base},"exdates":[]}]`))).not.toContain("exdates");
    expect(serializeEvents(parseEvents(`[{${base}}]`))).not.toContain("recurrence");
  });

  it("holds the file on a rule the app cannot expand or a bad exdate", () => {
    const base = '"id":"e","start":"2026-11-02","end":"2026-11-03","updatedAt":"2026-11-15T10:00:00.000+09:00"';
    expect(() => parseEvents(`[{${base},"recurrence":"FREQ=YEARLY;BYDAY=4TH"}]`)).toThrow();
    expect(() => parseEvents(`[{${base},"recurrence":"FREQ=WEEKLY","exdates":["20261109"]}]`)).toThrow();
    expect(() => parseEvents(`[{${base},"recurrence":"FREQ=WEEKLY","exdates":"2026-11-09"}]`)).toThrow();
  });

  it("color: #RRGGBB right after title on both kinds, uppercased, omitted when absent, file held on a bad value", () => {
    const stamp = '"updatedAt":"2026-11-15T10:00:00.000+09:00"';
    expect(serializeTasks(parseTasks(`[{"id":"a","title":"x","color":"#f12424",${stamp}}]`))).toContain('"title": "x",\n    "color": "#F12424",\n    "status"');
    const ev = '"id":"e","title":"y","start":"2026-11-02","end":"2026-11-03",' + stamp;
    expect(serializeEvents(parseEvents(`[{${ev},"color":"#00FF00"}]`))).toContain('"title": "y",\n    "color": "#00FF00",\n    "start"');
    expect(serializeEvents(parseEvents(`[{${ev}}]`))).not.toContain("color");
    expect(() => parseTasks(`[{"id":"a","color":"red",${stamp}}]`)).toThrow();
    expect(() => parseEvents(`[{${ev},"color":"#FFF"}]`)).toThrow();
  });

  it("rejects broken JSON and items without an id", () => {
    expect(() => parseTasks("[{")).toThrow();
    expect(() => parseTasks('[{"title":"no id"}]')).toThrow();
  });
});
