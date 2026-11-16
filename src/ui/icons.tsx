// Drawn for this project (no icon library). Decorative: the control that holds one carries the accessible name.
import type { ComponentChildren } from "preact";

const Svg = ({ children }: { children: ComponentChildren }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

/** The item's color key as a dot before its title; nothing when uncolored. */
export const Dot = ({ color }: { color?: string }) => (color ? <i class="dot" aria-hidden="true" style={{ background: color }} /> : null);

export const Prev = () => <Svg><path d="M10 3 5 8l5 5" /></Svg>;
export const Next = () => <Svg><path d="m6 3 5 5-5 5" /></Svg>;
export const Close = () => <Svg><path d="m4 4 8 8M12 4l-8 8" /></Svg>;
export const Gear = () => (
  <Svg>
    <circle cx="8" cy="8" r="4.5" />
    <circle cx="8" cy="8" r="1.75" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
  </Svg>
);
export const Check = () => <Svg><path d="m3 8.5 3 3 7-7" /></Svg>;
export const Clock = () => <Svg><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></Svg>;
export const Offline = () => <Svg><circle cx="8" cy="8" r="5.5" /><path d="m4 12 8-8" /></Svg>;
export const Merge = () => <Svg><path d="M4 2v3a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3V2M8 8v6" /></Svg>;
export const Warn = () => <Svg><path d="M8 2.5 14.5 13.5h-13z" /><path d="M8 6.5v3M8 11.6v.1" /></Svg>;
