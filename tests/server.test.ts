import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp, AppOptions } from "../src/server/app";
import { DeidentificationService } from "../src/service/service";
import { createLogger, LogLevel } from "../src/logger";

const servers: Server[] = [];

// Starts an app on a random port and returns its base URL. All servers are closed in afterAll.
async function start(options: AppOptions = {}, service?: DeidentificationService) {
  const server = createApp(service, options).listen(0);
  await new Promise((r) => server.once("listening", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterAll(() =>
  Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((r) => {
          s.close(() => r());
          s.closeAllConnections?.();
        })
    )
  )
);

const post = (base: string, path: string, body: unknown, raw = false, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });

describe("POST /deidentify", () => {
  let base: string;
  beforeAll(async () => {
    base = await start();
  });

  it("returns the documented response shape", async () => {
    const res = await post(base, "/deidentify", {
      text: "Contact john.doe@example.com at +1-415-555-0134",
      entities: ["EMAIL", "PHONE"],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deidentifiedText: "Contact [EMAIL] at [PHONE]",
      entitiesDetected: { EMAIL: 1, PHONE: 1 },
    });
  });

  it("uses defaults when entities is omitted", async () => {
    const res = await post(base, "/deidentify", { text: "10.0.0.1" });
    expect((await res.json()).deidentifiedText).toBe("[IP_ADDRESS]");
  });

  it.each([
    [{}, "text"],
    [{ text: 5 }, "text"],
    [{ text: "x", entities: ["NOPE"] }, "Unknown entities"],
    [[], "JSON object"],
  ])("400 for invalid body %j", async (body, msg) => {
    const res = await post(base, "/deidentify", body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(msg);
  });

  it("400 for malformed JSON", async () => {
    const res = await post(base, "/deidentify", "{bad", true);
    expect(res.status).toBe(400);
  });

  it("415 when the content type is not JSON", async () => {
    const res = await fetch(base + "/deidentify", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "a@b.com",
    });
    expect(res.status).toBe(415);
  });
});

describe("POST /deidentify/batch", () => {
  let base: string;
  beforeAll(async () => {
    base = await start();
  });

  it("de-identifies each record and keeps ids", async () => {
    const res = await post(base, "/deidentify/batch", { records: [{ id: 1, text: "a@b.com" }, "10.0.0.1"] });
    expect(await res.json()).toEqual({
      results: [
        { id: 1, deidentifiedText: "[EMAIL]", entitiesDetected: { EMAIL: 1 } },
        { deidentifiedText: "[IP_ADDRESS]", entitiesDetected: { IP_ADDRESS: 1 } },
      ],
    });
  });

  it("400 naming the bad record", async () => {
    const res = await post(base, "/deidentify/batch", { records: ["ok", { text: 5 }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("records[1]");
  });
});

describe("other endpoints", () => {
  let base: string;
  beforeAll(async () => {
    base = await start();
  });

  it("GET /entities lists supported and default entities", async () => {
    const j = await (await fetch(base + "/entities")).json();
    expect(j.supported).toContain("NAME");
    expect(j.default).not.toContain("NAME");
    expect(j.default).toContain("EMAIL");
  });

  it("GET /health", async () => {
    const res = await fetch(base + "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("404 JSON for unknown routes", async () => {
    const res = await fetch(base + "/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("/nope");
  });
});

describe("security headers and request ids", () => {
  let base: string;
  beforeAll(async () => {
    base = await start();
  });

  it("sets hardening headers and hides the framework", async () => {
    const res = await fetch(base + "/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("generates a request id and puts it in error bodies", async () => {
    const res = await post(base, "/deidentify", {});
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await res.json()).requestId).toBe(id);
  });

  it("reuses a sane incoming request id and replaces a hostile one", async () => {
    const ok = await fetch(base + "/health", { headers: { "x-request-id": "trace-123" } });
    expect(ok.headers.get("x-request-id")).toBe("trace-123");
    const bad = await fetch(base + "/health", { headers: { "x-request-id": "a b\tc" } });
    expect(bad.headers.get("x-request-id")).not.toBe("a b\tc");
  });
});

describe("body size limit", () => {
  it("413 when the body exceeds the configured limit", async () => {
    const base = await start({ bodyLimit: "1kb" });
    const res = await post(base, "/deidentify", { text: "x".repeat(5000) });
    expect(res.status).toBe(413);
  });
});

describe("API key auth", () => {
  let base: string;
  beforeAll(async () => {
    base = await start({ apiKeys: ["secret-one", "secret-two"] });
  });

  it("401 without a key, with a wrong key", async () => {
    expect((await post(base, "/deidentify", { text: "x" })).status).toBe(401);
    expect((await post(base, "/deidentify", { text: "x" }, false, { "x-api-key": "nope" })).status).toBe(401);
  });

  it("accepts either configured key via X-API-Key or Bearer", async () => {
    const a = await post(base, "/deidentify", { text: "a@b.com" }, false, { "x-api-key": "secret-two" });
    expect(a.status).toBe(200);
    const b = await post(base, "/deidentify", { text: "a@b.com" }, false, {
      authorization: "Bearer secret-one",
    });
    expect(b.status).toBe(200);
  });

  it("leaves /health open for load balancers", async () => {
    expect((await fetch(base + "/health")).status).toBe(200);
  });
});

describe("rate limiting", () => {
  it("429 with Retry-After once the limit is hit", async () => {
    const base = await start({ rateLimit: { max: 3, windowMs: 60_000 } });
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 5; i++) {
      last = await fetch(base + "/health");
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(last!.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

describe("logging", () => {
  it("logs calls and never writes request text, query strings or PII", async () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (_l: LogLevel, line: string) => lines.push(line) });
    const base = await start({ logger });
    await post(base, "/deidentify?email=secret@leak.com", { text: "Mail john.doe@example.com" });
    const all = lines.join("\n");
    expect(all).toContain("Called POST /deidentify");
    expect(all).toContain("Completed POST /deidentify with status 200");
    expect(all).not.toContain("john.doe");
    expect(all).not.toContain("secret@leak.com");
  });

  it("returns a generic 500 and logs the cause without leaking it to the caller", async () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (_l, line) => lines.push(line) });
    const service = new DeidentificationService();
    service.deidentify = () => {
      throw new Error("boom with internal detail");
    };
    const base = await start({ logger }, service);
    const res = await post(base, "/deidentify", { text: "x" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("boom");
    expect(lines.join("\n")).toContain("boom with internal detail");
  });
});
