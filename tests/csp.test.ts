// @ts-expect-error no @types/node (same as prefs.test.ts)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CSP (handoff §2-7)", () => {
  const sec = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security;
  it("release CSP has no dev server address", () => {
    expect(sec.csp).not.toMatch(/localhost:1420/);
  });
  it("dev CSP keeps the HMR websocket", () => {
    expect(sec.devCsp).toContain("ws://localhost:1420");
  });
});
