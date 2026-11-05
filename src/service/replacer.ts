import { Span } from "./types";

// Swaps each span for its placeholder. We slice the original text instead of using
// regex replace, so everything outside the spans comes through untouched.
export function replaceSpans(text: string, spans: Span[]): string {
  let out = "";
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) throw new Error("replaceSpans requires non-overlapping, sorted spans");
    out += text.slice(cursor, s.start) + s.placeholder;
    cursor = s.end;
  }
  return out + text.slice(cursor);
}
