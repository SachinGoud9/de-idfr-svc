import { describe, expect, it } from "vitest";
import { out } from "../../../helpers";

describe("PHONE", () => {
  it.each([
    "+1-415-555-0134",
    "+44 20 7946 0958",
    "(415) 555-0134",
    "415-555-0134",
    "415.555.0134",
    "415 555 0134",
    "1-415-555-0134",
    "0044 20 7946 0958",
    "+91 98765 43210",
    "+81 3-1234-5678",
    "+49 (0)30 123456",
    "90100 97404",
    "98765-43210",
  ])("detects %s", (p) => {
    expect(out(`Call ${p} now`)).toBe("Call [PHONE] now");
  });
  it("does not flag 5+5 digit pairs that cannot be Indian mobiles", () => {
    const t = "ref 12345 67890 and 55555 12345";
    expect(out(t, ["PHONE"])).toBe(t);
  });
  it("detects bare 10 digits only with a phone label", () => {
    expect(out("Phone: 4155550134")).toBe("Phone: [PHONE]");
    expect(out("Order 4155550134")).toBe("Order 4155550134");
  });
  it("does not flag ordinary numbers", () => {
    const t = "Total 1234567890, invoice 555-1234, ref 123-456-7890, id 20240512, 12.50 USD";
    expect(out(t)).toBe(t);
  });
  it("does not flag digit runs that merely start with 00", () => {
    const t = "ref 0012345678 and 2000 1234 5678";
    expect(out(t, ["PHONE"])).toBe(t);
  });
});
