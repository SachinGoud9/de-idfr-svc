import { describe, expect, it } from "vitest";
import { out, run } from "./helpers";

// Small seeded PRNG so a failure can be reproduced from the seed.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = "abcXYZ019 -.+()@:,;\t\r\n'\"/é张😀=DOBPhone";

function randomText(rand: () => number, len: number) {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

describe("fuzzing", () => {
  it("never throws and is idempotent on random input", () => {
    const rand = mulberry32(1234);
    for (let i = 0; i < 500; i++) {
      const text = randomText(rand, 1 + Math.floor(rand() * 200));
      const once = out(text);
      // Placeholders must never be re-detected as PII, otherwise output keeps changing.
      expect(out(once), `seed 1234, iteration ${i}, input ${JSON.stringify(text)}`).toBe(once);
    }
  });

  it("only ever changes text by swapping spans for placeholders", () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 200; i++) {
      const text = randomText(rand, 80);
      const r = run(text);
      const stripped = r.deidentifiedText.replace(/\[[A-Z_]+\]/g, "");
      // Everything left after removing placeholders must be a subsequence of the input.
      let pos = 0;
      for (const ch of stripped) {
        pos = text.indexOf(ch, pos);
        expect(pos, `input ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0);
        pos++;
      }
    }
  });
});

describe("adversarial input (regex backtracking)", () => {
  it.each([
    ["long local part with no @", "a".repeat(100_000)],
    ["many dots and dashes", "a.-".repeat(30_000)],
    ["almost an email", "a".repeat(50_000) + "@" + "b.".repeat(20_000)],
    ["long digit run", "1".repeat(100_000)],
    ["digits and separators", "1-".repeat(50_000)],
    ["unclosed parentheses", "(".repeat(50_000)],
    ["many plus signs", "+1 ".repeat(30_000)],
    ["birth label with no date", "DOB ".repeat(30_000)],
    ["name label with no value", "Name: ".repeat(30_000)],
    ["almost-IPs", "255.".repeat(30_000)],
  ])("%s finishes quickly", (_label, text) => {
    const start = Date.now();
    out(text, ["EMAIL", "PHONE", "SSN", "DATE_OF_BIRTH", "CREDIT_CARD", "IP_ADDRESS", "NAME"]);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
