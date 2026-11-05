import { describe, expect, it } from "vitest";
import { DeidentificationService, ValidationError } from "../src/service/service";
import { registerConfigRules } from "../src/config";
import { out, run, svc } from "./helpers";

// Tests for each individual rule live in tests/rules/. This file covers the
// service as a whole: combined behaviour, input validation, batch and custom rules.

describe("spec example", () => {
  it("de-identifies the reference sentence, leaving the name alone", () => {
    const r = run(
      "Patient John Doe can be contacted at john.doe@example.com or +1-415-555-0134. DOB: 1990-05-12."
    );
    expect(r.deidentifiedText).toBe(
      "Patient John Doe can be contacted at [EMAIL] or [PHONE]. DOB: [DATE_OF_BIRTH]."
    );
    expect(r.entitiesDetected).toEqual({ EMAIL: 1, PHONE: 1, DATE_OF_BIRTH: 1 });
  });

  it("honours the entities selection", () => {
    const r = run("Contact john.doe@example.com at +1-415-555-0134", ["EMAIL", "PHONE"]);
    expect(r).toEqual({
      deidentifiedText: "Contact [EMAIL] at [PHONE]",
      entitiesDetected: { EMAIL: 1, PHONE: 1 },
    });
    expect(out("a@b.com +1-415-555-0134", ["EMAIL"])).toBe("[EMAIL] +1-415-555-0134");
  });
});

describe("overlaps and defaults", () => {
  it("does not double-replace overlapping matches (SSN is not a phone)", () => {
    const r = run("123-45-6789");
    expect(r).toEqual({ deidentifiedText: "[SSN]", entitiesDetected: { SSN: 1 } });
  });
  it("prefers CREDIT_CARD over PHONE-like fragments", () => {
    expect(run("4111 1111 1111 1111", ["PHONE", "CREDIT_CARD"]).deidentifiedText).toBe("[CREDIT_CARD]");
  });
  it("applies all core entities by default but not NAME", () => {
    const r = run("Name: Jane Roe, jane@x.com");
    expect(r.deidentifiedText).toBe("Name: Jane Roe, [EMAIL]");
  });
  it("reports only detected entities", () => {
    expect(run("nothing here").entitiesDetected).toEqual({});
  });
});

describe("text integrity", () => {
  it("preserves line breaks, punctuation and Unicode", () => {
    const t = "Café — 张伟 😀\r\nSSN: 123-45-6789;\nIP\t10.0.0.1 «ok» a@b.com…";
    expect(out(t)).toBe("Café — 张伟 😀\r\nSSN: [SSN];\nIP\t[IP_ADDRESS] «ok» [EMAIL]…");
  });
  it("returns text without PII unchanged", () => {
    const t = "  Hello,\n\n  world! $1,234.56 (50%)  ";
    expect(out(t)).toBe(t);
  });
  it("handles empty string", () => {
    expect(run("")).toEqual({ deidentifiedText: "", entitiesDetected: {} });
  });
  it("is stable across repeated calls (no regex lastIndex leakage)", () => {
    expect(out("a@b.com")).toBe("[EMAIL]");
    expect(out("a@b.com")).toBe("[EMAIL]");
  });
  it("handles large input quickly", () => {
    const t = "x@y.com 4155550134 ".repeat(20000);
    const start = Date.now();
    out(t);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe("invalid input", () => {
  it.each([undefined, null, 42, {}, [], true])("rejects text=%j", (t) => {
    expect(() => svc.deidentify(t)).toThrow(ValidationError);
  });
  it("rejects bad entities", () => {
    expect(() => svc.deidentify("x", { entities: ["FOO"] })).toThrow(/Unknown entities: FOO/);
    expect(() => svc.deidentify("x", { entities: [] })).toThrow(ValidationError);
    expect(() => svc.deidentify("x", { entities: "EMAIL" })).toThrow(ValidationError);
    expect(() => svc.deidentify("x", { entities: [1] })).toThrow(ValidationError);
  });
  it("accepts lower-case entity names", () => {
    expect(out("a@b.com", ["email"])).toBe("[EMAIL]");
  });
});

describe("batch", () => {
  it("processes multiple records and keeps ids", () => {
    const r = svc.deidentifyBatch([{ id: "a", text: "a@b.com" }, "no pii", { text: "10.0.0.1" }]);
    expect(r).toEqual([
      { id: "a", deidentifiedText: "[EMAIL]", entitiesDetected: { EMAIL: 1 } },
      { deidentifiedText: "no pii", entitiesDetected: {} },
      { deidentifiedText: "[IP_ADDRESS]", entitiesDetected: { IP_ADDRESS: 1 } },
    ]);
  });
  it("rejects invalid batches", () => {
    expect(() => svc.deidentifyBatch([])).toThrow(ValidationError);
    expect(() => svc.deidentifyBatch([{ text: 5 }])).toThrow(/records\[0\]/);
  });
});

describe("custom rules", () => {
  it("can be added from configuration without touching core code", () => {
    const s = new DeidentificationService();
    registerConfigRules(s.registry, [{ entity: "EMPLOYEE_ID", pattern: "\\bEMP-\\d{6}\\b" }]);
    expect(s.deidentify("id EMP-123456 ok").deidentifiedText).toBe("id [EMPLOYEE_ID] ok");
  });
  it("supports capture groups and custom placeholders", () => {
    const s = new DeidentificationService();
    registerConfigRules(s.registry, [
      { entity: "MRN", pattern: "MRN:\\s*(\\d+)", group: 1, placeholder: "<MRN>" },
    ]);
    expect(s.deidentify("MRN: 99812").deidentifiedText).toBe("MRN: <MRN>");
  });
  it("rejects malformed config", () => {
    expect(() =>
      registerConfigRules(new DeidentificationService().registry, [{ entity: "bad name", pattern: "x" }])
    ).toThrow();
  });
});
