import { describe, expect, it } from "vitest";
import { out } from "../../../helpers";

describe("SSN", () => {
  it("detects valid SSNs", () => expect(out("SSN 123-45-6789.")).toBe("SSN [SSN]."));
  it.each([
    "000-12-3456",
    "666-12-3456",
    "900-12-3456",
    "123-00-4567",
    "123-45-0000",
    "123-45-678",
    "1123-45-6789",
  ])("rejects %s", (s) => expect(out(`x ${s} y`, ["SSN"])).toBe(`x ${s} y`));
});
