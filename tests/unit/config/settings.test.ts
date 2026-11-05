import { describe, expect, it } from "vitest";
import { loadSettings } from "../../../src/config/settings";
import { createLogger } from "../../../src/utils/logger";

describe("loadSettings", () => {
  it("has safe defaults", () => {
    expect(loadSettings({})).toMatchObject({
      port: 3000,
      logRequests: true,
      logFormat: "text",
      bodyLimit: "2mb",
      rateLimitMax: 0,
      apiKeys: [],
      trustProxy: false,
    });
  });

  it("parses provided values", () => {
    const s = loadSettings({
      PORT: "8080",
      LOG_REQUESTS: "false",
      LOG_FORMAT: "JSON",
      RATE_LIMIT_MAX: "100",
      API_KEYS: " a , b ,, ",
      BODY_LIMIT: "512kb",
      TRUST_PROXY: "yes",
    });
    expect(s).toMatchObject({
      port: 8080,
      logRequests: false,
      logFormat: "json",
      rateLimitMax: 100,
      apiKeys: ["a", "b"],
      bodyLimit: "512kb",
      trustProxy: true,
    });
  });

  it.each([
    [{ PORT: "abc" }, /PORT/],
    [{ PORT: "70000" }, /PORT/],
    [{ LOG_REQUESTS: "maybe" }, /LOG_REQUESTS/],
    [{ LOG_FORMAT: "xml" }, /LOG_FORMAT/],
    [{ BODY_LIMIT: "lots" }, /BODY_LIMIT/],
    [{ RATE_LIMIT_MAX: "-1" }, /RATE_LIMIT_MAX/],
  ])("rejects bad config %j", (env, msg) => {
    expect(() => loadSettings(env)).toThrow(msg);
  });
});

describe("logger", () => {
  it("writes human readable lines", () => {
    const lines: string[] = [];
    createLogger({ write: (_l, line) => lines.push(line) }).info("Called GET /x", { requestId: "r1" });
    expect(lines[0]).toMatch(/^\S+ INFO Called GET \/x requestId=r1$/);
  });

  it("writes one JSON object per line in json mode", () => {
    const lines: string[] = [];
    createLogger({ format: "json", write: (_l, line) => lines.push(line) }).error("bad", { code: 500 });
    expect(JSON.parse(lines[0])).toMatchObject({ level: "error", msg: "bad", code: 500 });
  });
});
