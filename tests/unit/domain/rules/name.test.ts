import { describe, expect, it } from "vitest";
import { out } from "../../../helpers";

describe("NAME (context-based, opt-in)", () => {
  it("detects names after a label", () => {
    expect(out("Patient Name: John Doe\nDOB: 1990-05-12", ["NAME", "DATE_OF_BIRTH"])).toBe(
      "Patient Name: [NAME]\nDOB: [DATE_OF_BIRTH]"
    );
    expect(out("Name: José Müller-Smith", ["NAME"])).toBe("Name: [NAME]");
  });
  it("does not match without a label or inside other words", () => {
    expect(out("John Doe came. Username: Bob", ["NAME"])).toBe("John Doe came. Username: Bob");
  });
});
