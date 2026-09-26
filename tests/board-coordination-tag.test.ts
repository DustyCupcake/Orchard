import { describe, expect, it } from "vitest";
import { needsNamedCoordinator } from "@/app/(app)/board/coordination-tag";

// The "Coordinated by {name}" tag. Regression cover for a real report:
// one branch-wide branch_coordination grant made *every* task in the
// branch read "Coordinated by {name}", because the tag reused the same
// predicate as the viewer's coordination coverage. Column semantics mean
// a cycle-less coordination task covers its whole branch across all
// cycles, so coverage is true for ~100% of a branch's tasks and the tag
// carried no information on any of them.
describe("needsNamedCoordinator", () => {
  const base = { attentionLevel: "ok", critical: false, status: "claimed" } as const;

  it("is false for a healthy task the viewer's coverage happens to reach", () => {
    // The regression itself: coverage said yes, the tag now says no.
    expect(needsNamedCoordinator(base)).toBe(false);
    expect(needsNamedCoordinator({ ...base, status: "done" })).toBe(false);
    expect(needsNamedCoordinator({ ...base, status: "waiting" })).toBe(false);
    expect(needsNamedCoordinator({ ...base, critical: true, status: "claimed" })).toBe(false);
  });

  it("is false for a soft/hard flag that hasn't escalated yet", () => {
    expect(needsNamedCoordinator({ ...base, attentionLevel: "soft" })).toBe(false);
    expect(needsNamedCoordinator({ ...base, attentionLevel: "hard", critical: true })).toBe(false);
  });

  it("is true for an escalated task — the queue coordination exists to clear", () => {
    expect(needsNamedCoordinator({ ...base, attentionLevel: "escalated" })).toBe(true);
    expect(needsNamedCoordinator({ ...base, attentionLevel: "escalated", critical: true })).toBe(true);
    expect(needsNamedCoordinator({ ...base, attentionLevel: "escalated", status: "unclaimed" })).toBe(true);
  });

  it("is true for an unclaimed critical — the same trigger as the neighbouring backstop tag", () => {
    expect(needsNamedCoordinator({ ...base, critical: true, status: "unclaimed" })).toBe(true);
  });

  it("is false for a non-critical unclaimed task, which is just the ordinary queue", () => {
    expect(needsNamedCoordinator({ ...base, status: "unclaimed" })).toBe(false);
  });
});
