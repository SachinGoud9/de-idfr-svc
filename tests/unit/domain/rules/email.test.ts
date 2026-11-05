import { describe, expect, it } from "vitest";
import { out, run } from "../../../helpers";

describe("EMAIL", () => {
  it("handles plus tags, subdomains and trailing punctuation", () => {
    expect(out("Mail a.b+tag@sub.example.co.uk.")).toBe("Mail [EMAIL].");
    expect(out("(x@y.io)")).toBe("([EMAIL])");
  });
  it("counts multiple occurrences", () => {
    const r = run("a@x.com, b@y.org and a@x.com");
    expect(r.deidentifiedText).toBe("[EMAIL], [EMAIL] and [EMAIL]");
    expect(r.entitiesDetected.EMAIL).toBe(3);
  });
  it("handles apostrophes inside the local part", () => {
    expect(out("o'brien@example.com")).toBe("[EMAIL]");
  });
  it("does not swallow surrounding punctuation", () => {
    expect(out("'john@x.com'")).toBe("'[EMAIL]'");
    expect(out("email=john@x.com&x=1")).toBe("email=[EMAIL]&x=1");
    expect(out('<john@x.com>, "jane@x.com"')).toBe('<[EMAIL]>, "[EMAIL]"');
  });
  it("finds emails across lines and next to Unicode text", () => {
    expect(out("名前: 张伟\r\nmail:a@b.co\n")).toBe("名前: 张伟\r\nmail:[EMAIL]\n");
  });
  it("known limitation: other RFC specials like ! split the match", () => {
    // Accepting them would corrupt "key=value" text, so the part before ! is left behind.
    expect(out("joh!n@example.com")).toBe("joh![EMAIL]");
  });
  it("ignores non-emails", () => {
    expect(out("user@ and @handle and a@b")).toBe("user@ and @handle and a@b");
  });
});
