import { Rule, Span } from "./types";

// Runs every rule on the text. The spans it returns can overlap, we sort that out later.
export function findCandidates(text: string, rules: Rule[]): Span[] {
  const spans: Span[] = [];
  for (const rule of rules) {
    // matchAll works on a copy of the regex, so lastIndex never leaks between calls.
    for (const m of text.matchAll(rule.pattern)) {
      const range = rule.group === undefined ? [m.index!, m.index! + m[0].length] : m.indices?.[rule.group];
      if (!range) continue;
      const [start, end] = range;
      if (end <= start) continue;
      if (rule.validate && !rule.validate(text.slice(start, end), { text, start, end })) continue;
      spans.push({
        start,
        end,
        entity: rule.entity,
        priority: rule.priority,
        placeholder: rule.placeholder ?? `[${rule.entity}]`,
      });
    }
  }
  return spans;
}

// When spans overlap, keep the one with the higher priority. Ties go to the longer
// span, then to whichever starts first. Result is sorted by position.
export function resolveOverlaps(candidates: Span[]): Span[] {
  const ranked = [...candidates].sort(
    (a, b) => b.priority - a.priority || b.end - b.start - (a.end - a.start) || a.start - b.start
  );
  // Accepted spans never overlap and are kept sorted by start. That means a new span can
  // only collide with its immediate neighbours, so a binary search finds them. Checking
  // every accepted span instead is O(n^2) and crawls once a text has tens of thousands of matches.
  const accepted: Span[] = [];
  for (const c of ranked) {
    let lo = 0;
    let hi = accepted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (accepted[mid].start < c.start) lo = mid + 1;
      else hi = mid;
    }
    const before = accepted[lo - 1];
    const after = accepted[lo];
    if (before && before.end > c.start) continue;
    if (after && after.start < c.end) continue;
    accepted.splice(lo, 0, c);
  }
  return accepted;
}

export function detect(text: string, rules: Rule[]): Span[] {
  return resolveOverlaps(findCandidates(text, rules));
}
