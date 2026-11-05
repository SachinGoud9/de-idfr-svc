import { describe, expect, it } from "vitest";
import { resolveOverlaps } from "../../../src/domain/detector";
import { replaceSpans } from "../../../src/domain/replacer";
import { Span } from "../../../src/domain/types";

const span = (start: number, end: number, priority: number, entity = "X"): Span => ({
  start,
  end,
  priority,
  entity,
  placeholder: `[${entity}]`,
});

// The obvious (slow) version, used as the reference answer.
function naive(candidates: Span[]): Span[] {
  const ranked = [...candidates].sort(
    (a, b) => b.priority - a.priority || b.end - b.start - (a.end - a.start) || a.start - b.start
  );
  const accepted: Span[] = [];
  for (const c of ranked) {
    if (!accepted.some((a) => c.start < a.end && a.start < c.end)) accepted.push(c);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

describe("resolveOverlaps", () => {
  it("prefers higher priority, then longer, then earlier", () => {
    expect(resolveOverlaps([span(0, 10, 1, "LOW"), span(5, 8, 9, "HIGH")]).map((s) => s.entity)).toEqual([
      "HIGH",
    ]);
    expect(resolveOverlaps([span(0, 4, 5, "SHORT"), span(2, 9, 5, "LONG")]).map((s) => s.entity)).toEqual([
      "LONG",
    ]);
    expect(resolveOverlaps([span(0, 5, 5, "A"), span(3, 8, 5, "B")]).map((s) => s.entity)).toEqual(["A"]);
  });

  it("keeps touching spans (end == start is not an overlap)", () => {
    expect(resolveOverlaps([span(0, 3, 1), span(3, 6, 1)])).toHaveLength(2);
  });

  it("returns spans sorted by position", () => {
    const r = resolveOverlaps([span(20, 25, 1), span(0, 5, 1), span(10, 15, 1)]);
    expect(r.map((s) => s.start)).toEqual([0, 10, 20]);
  });

  it("handles no candidates", () => {
    expect(resolveOverlaps([])).toEqual([]);
  });

  it("gives the same answer as the brute-force version on random spans", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let round = 0; round < 300; round++) {
      const spans: Span[] = [];
      for (let i = 0; i < 40; i++) {
        const start = Math.floor(rand() * 100);
        spans.push(span(start, start + 1 + Math.floor(rand() * 15), Math.floor(rand() * 4), `E${i}`));
      }
      expect(resolveOverlaps(spans)).toEqual(naive(spans));
    }
  });

  it("scales to many spans", () => {
    const spans = Array.from({ length: 100_000 }, (_, i) => span(i * 3, i * 3 + 2, 1));
    const start = Date.now();
    expect(resolveOverlaps(spans)).toHaveLength(100_000);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe("replaceSpans", () => {
  it("copies untouched text byte for byte", () => {
    const text = "a\r\n é张😀 b@c.de!";
    const start = text.indexOf("b@c.de");
    expect(replaceSpans(text, [span(start, start + 6, 1, "EMAIL")])).toBe("a\r\n é张😀 [EMAIL]!");
  });

  it("rejects overlapping or unsorted spans instead of corrupting text", () => {
    expect(() => replaceSpans("abcdef", [span(0, 4, 1), span(2, 5, 1)])).toThrow();
  });
});
