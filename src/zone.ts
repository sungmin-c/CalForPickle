// Time zones: the screen, input and new stamps follow the PC's zone, read once at startup.
// A zone is an IANA name ("America/New_York") or a fixed offset ("+09:00", "Z") taken from a stored stamp.

/** The PC's zone. Changing the Windows zone needs an app restart. */
export let ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Tests only. */
export const setZone = (z: string) => void (ZONE = z);

const FIXED = /^(?:Z|([+-])(\d{2}):(\d{2}))$/;
const formats = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();

/** Minutes east of UTC in that zone at that instant. */
export function offsetMin(ms: number, zone = ZONE): number {
  const f = FIXED.exec(zone);
  if (f) return f[1] ? (f[1] === "-" ? -1 : 1) * (Number(f[2]) * 60 + Number(f[3])) : 0;
  // Offsets change on quarter-hour boundaries, so one Intl call answers a whole 15 minutes (Intl is ~1000x slower than math).
  // ponytail: unbounded cache, a few thousand entries per year of calendar shown; add an LRU if it ever matters.
  const key = `${zone}|${Math.floor(ms / 900_000)}`;
  const hit = offsets.get(key);
  if (hit !== undefined) return hit;
  let fmt = formats.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formats.set(zone, fmt);
  }
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(ms)) p[x.type] = Number(x.value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const off = Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
  offsets.set(key, off);
  return off;
}

/** "2026-11-15T10:00:00.000-05:00". */
export function stampIn(ms: number, zone = ZONE): string {
  const off = offsetMin(ms, zone);
  const a = Math.abs(off);
  const hm = `${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  return new Date(ms + off * 60_000).toISOString().slice(0, 23) + (off < 0 ? "-" : "+") + hm;
}

/** Calendar date "YYYY-MM-DD" of an instant in that zone. */
export const dateIn = (ms: number, zone = ZONE) => stampIn(ms, zone).slice(0, 10);

/** Instant of a wall time ("HH:mm" or "HH:mm:ss") on a date in that zone. A time skipped by DST lands next to the gap. */
export function at(date: string, time: string, zone = ZONE): number {
  const wall = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  const guess = wall - offsetMin(wall, zone) * 60_000;
  return wall - offsetMin(guess, zone) * 60_000;
}

const starts = new Map<string, number>();
/** Local midnight that starts a day (memoized: the calendar asks for the same few days thousands of times per render). */
export function dayStart(date: string, zone = ZONE): number {
  const key = `${zone}|${date}`;
  let v = starts.get(key);
  if (v === undefined) starts.set(key, (v = at(date, "00:00", zone)));
  return v;
}

/** The zone a stored stamp was written in: its tz, else its own offset (a bare date or no offset is Seoul, the old format). */
export function zoneOf(stamp: string, tz?: string): string {
  return tz ?? /(Z|[+-]\d{2}:\d{2})$/.exec(stamp)?.[1] ?? "+09:00";
}
