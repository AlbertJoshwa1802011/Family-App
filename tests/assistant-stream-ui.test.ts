/**
 * Source-level contracts for the Money assistant streaming UX.
 * (No jsdom component suite in this repo — pin the critical strings.)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/money/Assistant.tsx", "utf8");

describe("Money assistant streaming UX contracts", () => {
  it("requests SSE from /assistant/chat", () => {
    expect(src).toContain('Accept: "text/event-stream"');
    expect(src).toContain('fetch("/api/assistant/chat"');
  });

  it("clears busy as soon as reply text arrives", () => {
    expect(src).toContain("Clear \"thinking\" as soon as any reply text arrives");
    expect(src).toMatch(/appendModel[\s\S]*?setBusy\(false\)/);
    // Must not await invalidation before clearing thinking.
    expect(src).toContain('void qc.invalidateQueries({ queryKey: ["expenses"] })');
    expect(src).not.toMatch(/await qc\.invalidateQueries/);
  });

  it("parses token / done / error SSE events", () => {
    expect(src).toContain('ev.type === "token"');
    expect(src).toContain('ev.type === "done"');
    expect(src).toContain('ev.type === "error"');
  });

  it("hides the thinking dots once the model bubble has text", () => {
    expect(src).toContain("turns[turns.length - 1]!.text.length > 0");
  });
});
