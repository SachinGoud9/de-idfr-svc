import { describe, expect, it } from "vitest";
import { out } from "../helpers";

describe("CREDIT_CARD", () => {
  it.each([
    "4111111111111111",
    "4111 1111 1111 1111",
    "4111-1111-1111-1111",
    "5555555555554444",
    "378282246310005",
    "3782 822463 10005",
  ])("detects valid card %s", (c) => expect(out(`Card ${c}.`)).toBe("Card [CREDIT_CARD]."));
  it("rejects numbers failing Luhn", () => {
    expect(out("Card 4111 1111 1111 1112")).toBe("Card 4111 1111 1111 1112");
  });
  it("rejects Luhn-valid numbers with an unknown issuer prefix", () => {
    expect(out("n 0000000000000000")).toBe("n 0000000000000000");
  });
  it("does not merge two adjacent numbers", () => {
    expect(out("4111111111111111 5555555555554444")).toBe("[CREDIT_CARD] [CREDIT_CARD]");
  });
});
