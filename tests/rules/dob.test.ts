import { describe, expect, it } from "vitest";
import { out } from "../helpers";

describe("DATE_OF_BIRTH", () => {
  it.each([
    "DOB: 1990-05-12",
    "DOB 05/12/1990",
    "D.O.B. 12.05.1990",
    "Date of Birth: May 12, 1990",
    "born on 12 May 1990",
    "Birthdate = 1990/05/12",
  ])("detects %s and keeps the label", (s) => {
    const r = out(s);
    expect(r).toContain("[DATE_OF_BIRTH]");
    expect(r).not.toMatch(/1990/);
  });
  it("keeps the label text", () => expect(out("DOB: 1990-05-12")).toBe("DOB: [DATE_OF_BIRTH]"));
  it("requires birth context", () => {
    expect(out("Released on 1990-05-12")).toBe("Released on 1990-05-12");
  });
  it("rejects impossible dates", () => {
    expect(out("DOB: 1990-02-30")).toBe("DOB: 1990-02-30");
    expect(out("DOB: 1990-13-01")).toBe("DOB: 1990-13-01");
    expect(out("DOB: 2999-01-01")).toBe("DOB: 2999-01-01");
  });
});
