import { describe, expect, it } from "vitest";
import { out } from "../../../helpers";

describe("IP_ADDRESS", () => {
  it("detects IPv4", () =>
    expect(out("from 192.168.1.1, 10.0.0.255.")).toBe("from [IP_ADDRESS], [IP_ADDRESS]."));
  it.each(["256.1.1.1", "999.999.999.999", "1.2.3", "01.2.3.4", "1.2.3.4.5"])("rejects %s", (ip) =>
    expect(out(`ip ${ip} end`)).toBe(`ip ${ip} end`)
  );
});
