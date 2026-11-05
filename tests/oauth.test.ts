import { afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { createApp, AppOptions } from "../src/server/app";
import { createLogger, LogLevel } from "../src/logger";
import { createTokenVerifier, OAuthOptions, TokenError } from "../src/server/oauth";
import { loadSettings } from "../src/settings";
import { createSigningKey, signJwt, SigningKey } from "../scripts/jwtSigner";
import { createMockOAuthServer } from "../scripts/mockOAuthServer";

const ISS = "https://idp.example.com/";
const AUD = "de-idfr-svc";
const START = 1_700_000_000_000; // ms

const claims = (over: Record<string, unknown> = {}) => ({
  iss: ISS,
  aud: AUD,
  sub: "client-1",
  exp: START / 1000 + 3600,
  scope: "deidfr:write",
  ...over,
});

// A verifier wired to an in-memory JWKS and a clock the test controls.
function harness(initial: SigningKey[], over: Partial<OAuthOptions> = {}) {
  const state = {
    t: START,
    fetches: 0,
    keys: initial.map((k) => k.jwk) as unknown[],
    fail: false,
    doc: undefined as unknown,
  };
  const verify = createTokenVerifier({
    issuer: ISS,
    audience: AUD,
    jwksUri: "unused",
    now: () => state.t,
    fetchJwks: async () => {
      state.fetches++;
      if (state.fail) throw new Error("idp down");
      return (state.doc ?? { keys: state.keys }) as { keys: never[] };
    },
    ...over,
  });
  return { verify, state };
}

const rsa = createSigningKey("RS256", "rsa-1");
const ec = createSigningKey("ES256", "ec-1");

const rejectsWith = (p: Promise<unknown>, code: string, message?: RegExp) =>
  expect(p).rejects.toMatchObject({ code, ...(message ? { message: expect.stringMatching(message) } : {}) });

describe("token verification", () => {
  it("accepts a valid RS256 token and returns its claims and scopes", async () => {
    const { verify } = harness([rsa]);
    const c = await verify(signJwt(rsa, claims({ scope: "deidfr:read deidfr:write" })));
    expect(c.sub).toBe("client-1");
    expect(c.scopes).toEqual(["deidfr:read", "deidfr:write"]);
  });

  it("accepts a valid ES256 token", async () => {
    const { verify } = harness([ec]);
    expect((await verify(signJwt(ec, claims()))).sub).toBe("client-1");
  });

  it("reads scopes from `scp` arrays and accepts an audience list", async () => {
    const { verify } = harness([rsa], { requiredScopes: ["a", "b"] });
    const c = await verify(signJwt(rsa, claims({ scope: undefined, scp: ["a", "b"], aud: ["other", AUD] })));
    expect(c.scopes).toEqual(["a", "b"]);
    // ...and a space-separated `scp` string (Entra ID style), mixed with `scope`
    const d = await verify(signJwt(rsa, claims({ scope: "a", scp: "b" })));
    expect(d.scopes).toEqual(["a", "b"]);
  });

  describe("time claims", () => {
    it("rejects an expired token but allows small clock drift", async () => {
      const { verify } = harness([rsa]);
      await rejectsWith(verify(signJwt(rsa, claims({ exp: START / 1000 - 31 }))), "invalid_token", /expired/);
      expect((await verify(signJwt(rsa, claims({ exp: START / 1000 - 10 })))).sub).toBe("client-1");
    });

    it("rejects tokens that are not valid yet, and tokens without an expiry", async () => {
      const { verify } = harness([rsa]);
      await rejectsWith(
        verify(signJwt(rsa, claims({ nbf: START / 1000 + 120 }))),
        "invalid_token",
        /not valid yet/
      );
      await rejectsWith(verify(signJwt(rsa, claims({ nbf: "soon" }))), "invalid_token", /not valid yet/);
      expect((await verify(signJwt(rsa, claims({ nbf: START / 1000 + 10 })))).sub).toBe("client-1");
      await rejectsWith(verify(signJwt(rsa, claims({ exp: undefined }))), "invalid_token", /no expiry/);
    });
  });

  it("rejects the wrong issuer and the wrong audience", async () => {
    const { verify } = harness([rsa]);
    await rejectsWith(
      verify(signJwt(rsa, claims({ iss: "https://evil.example" }))),
      "invalid_token",
      /issuer/
    );
    await rejectsWith(verify(signJwt(rsa, claims({ aud: "other-api" }))), "invalid_token", /audience/);
    await rejectsWith(verify(signJwt(rsa, claims({ aud: ["other-api"] }))), "invalid_token", /audience/);
    await rejectsWith(verify(signJwt(rsa, claims({ aud: undefined }))), "invalid_token", /audience/);
  });

  describe("signature and algorithm attacks", () => {
    it("rejects a token signed by a different key that claims the trusted kid", async () => {
      const { verify } = harness([rsa]);
      const attacker = createSigningKey("RS256", "rsa-1");
      await rejectsWith(verify(signJwt(attacker, claims())), "invalid_token", /signature/);
    });

    it("rejects a tampered payload", async () => {
      const { verify } = harness([rsa]);
      const [h, , s] = signJwt(rsa, claims()).split(".");
      const forged = Buffer.from(JSON.stringify(claims({ sub: "admin" }))).toString("base64url");
      await rejectsWith(verify(`${h}.${forged}.${s}`), "invalid_token", /signature/);
    });

    it('rejects alg "none" and HMAC algorithms', async () => {
      const { verify } = harness([rsa]);
      const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
      await rejectsWith(verify(`${enc({ alg: "none" })}.${enc(claims())}.sig`), "invalid_token", /algorithm/);
      await rejectsWith(verify(`${enc({ alg: "none" })}.${enc(claims())}.`), "invalid_token", /Not a JWT/);
      await rejectsWith(
        verify(`${enc({ alg: "HS256", kid: "rsa-1" })}.${enc(claims())}.sig`),
        "invalid_token",
        /algorithm/
      );
    });

    it("only accepts algorithms on the allow-list", async () => {
      const { verify } = harness([rsa, ec], { algorithms: ["RS256"] });
      await rejectsWith(verify(signJwt(ec, claims())), "invalid_token", /algorithm/);
      expect((await verify(signJwt(rsa, claims()))).sub).toBe("client-1");
    });

    it("will not verify an RSA key as if it were an EC key (algorithm confusion)", async () => {
      const { verify } = harness([rsa]);
      await rejectsWith(
        verify(signJwt(rsa, claims(), { alg: "ES256" })),
        "invalid_token",
        /No matching signing key/
      );
    });
  });

  it("rejects things that are not JWTs", async () => {
    const { verify } = harness([rsa]);
    const enc = (v: unknown) =>
      Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
    await rejectsWith(verify("abc"), "invalid_token", /Not a JWT/);
    await rejectsWith(verify("a..c"), "invalid_token", /Not a JWT/);
    await rejectsWith(verify("a.b.c"), "invalid_token", /Malformed token header/);
    await rejectsWith(verify(`${enc("[1]")}.x.y`), "invalid_token", /Malformed token header/);
    await rejectsWith(
      verify(`${enc({ alg: "RS256" })}.${enc("{not json")}.y`),
      "invalid_token",
      /Malformed token payload/
    );
  });

  describe("scopes", () => {
    it("reports which required scopes are missing", async () => {
      const { verify } = harness([rsa], { requiredScopes: ["deidfr:write", "deidfr:admin"] });
      const err = await verify(signJwt(rsa, claims({ scope: "deidfr:write" }))).catch((e) => e);
      expect(err).toBeInstanceOf(TokenError);
      expect(err).toMatchObject({ code: "insufficient_scope", missingScopes: ["deidfr:admin"] });
    });

    it("does not check scopes when none are required", async () => {
      const { verify } = harness([rsa]);
      expect((await verify(signJwt(rsa, claims({ scope: undefined })))).scopes).toEqual([]);
    });
  });

  describe("key lookup", () => {
    it("fetches keys once and reuses them until the cache expires", async () => {
      const { verify, state } = harness([rsa], { jwksCacheMs: 60_000 });
      await verify(signJwt(rsa, claims()));
      await verify(signJwt(rsa, claims()));
      expect(state.fetches).toBe(1);
      state.t += 61_000;
      await verify(signJwt(rsa, claims({ exp: state.t / 1000 + 60 })));
      expect(state.fetches).toBe(2);
    });

    it("shares one fetch between simultaneous requests", async () => {
      const { verify, state } = harness([rsa]);
      await Promise.all(Array.from({ length: 5 }, () => verify(signJwt(rsa, claims()))));
      expect(state.fetches).toBe(1);
    });

    it("picks up a rotated key, but not more than once per cooldown", async () => {
      const { verify, state } = harness([rsa], { jwksCooldownMs: 30_000 });
      await verify(signJwt(rsa, claims()));
      const rotated = createSigningKey("RS256", "rsa-2");
      state.keys = [rsa.jwk, rotated.jwk];

      // Unknown kid right after a fetch: no refetch, so attackers can't force one per request.
      await rejectsWith(verify(signJwt(rotated, claims())), "invalid_token", /No matching signing key/);
      expect(state.fetches).toBe(1);

      state.t += 31_000;
      const ok = await verify(signJwt(rotated, claims({ exp: state.t / 1000 + 60 })));
      expect(ok.sub).toBe("client-1");
      expect(state.fetches).toBe(2);
    });

    it("works without a kid only when a single key could match", async () => {
      const one = harness([rsa]);
      expect((await one.verify(signJwt(rsa, claims(), { kid: undefined }))).sub).toBe("client-1");
      const two = harness([rsa, createSigningKey("RS256", "rsa-9")]);
      await rejectsWith(
        two.verify(signJwt(rsa, claims(), { kid: undefined })),
        "invalid_token",
        /No matching signing key/
      );
    });

    it("ignores keys meant for encryption and keys it cannot parse", async () => {
      const enc = { ...rsa.jwk, use: "enc" };
      const broken = { kty: "RSA", kid: "broken" };
      const { verify, state } = harness([]);
      state.keys = [broken, enc];
      await rejectsWith(verify(signJwt(rsa, claims())), "invalid_token", /No matching signing key/);
      state.keys = [broken, rsa.jwk];
      state.t += 31_000;
      expect((await verify(signJwt(rsa, claims({ exp: state.t / 1000 + 60 })))).sub).toBe("client-1");
    });
  });

  describe("when the identity provider is unreachable", () => {
    it("reports jwks_unavailable, then backs off instead of retrying on every request", async () => {
      const { verify, state } = harness([rsa], { jwksCooldownMs: 30_000 });
      state.fail = true;
      await rejectsWith(verify(signJwt(rsa, claims())), "jwks_unavailable", /idp down/);
      await rejectsWith(verify(signJwt(rsa, claims())), "jwks_unavailable", /retrying shortly/);
      expect(state.fetches).toBe(1);

      state.fail = false;
      state.t += 31_000;
      expect((await verify(signJwt(rsa, claims({ exp: state.t / 1000 + 60 })))).sub).toBe("client-1");
    });

    it("keeps using the keys it already has", async () => {
      const { verify, state } = harness([rsa], { jwksCacheMs: 60_000 });
      await verify(signJwt(rsa, claims()));
      state.fail = true;
      state.t += 120_000;
      expect((await verify(signJwt(rsa, claims({ exp: state.t / 1000 + 60 })))).sub).toBe("client-1");
      // A kid it never saw still fails cleanly, and doesn't crash on the outage.
      await rejectsWith(
        verify(signJwt(createSigningKey("RS256", "new"), claims({ exp: state.t / 1000 + 60 }))),
        "invalid_token"
      );
    });

    it("treats a JWKS document without keys as unavailable", async () => {
      const { verify, state } = harness([rsa]);
      state.doc = { nope: true };
      await rejectsWith(verify(signJwt(rsa, claims())), "jwks_unavailable", /no keys array/);
    });
  });
});

// ---- HTTP behaviour ---------------------------------------------------------------------------

const servers: Server[] = [];
async function start(options: AppOptions = {}) {
  const server = createApp(undefined, options).listen(0);
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

const call = (base: string, path = "/deidentify", headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ text: "mail a@b.com" }),
  });

const liveClaims = (over: Record<string, unknown> = {}) =>
  claims({ exp: Math.floor(Date.now() / 1000) + 3600, ...over });

function oauthApp(over: Partial<OAuthOptions> = {}, appOptions: AppOptions = {}) {
  const verifier = createTokenVerifier({
    issuer: ISS,
    audience: AUD,
    jwksUri: "unused",
    fetchJwks: async () => ({ keys: [rsa.jwk] }),
    ...over,
  });
  return start({ tokenVerifier: verifier, ...appOptions });
}

describe("OAuth over HTTP", () => {
  it("401 with a WWW-Authenticate challenge when no token is sent", async () => {
    const base = await oauthApp();
    const res = await call(base);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="de-idfr-svc"');
    expect(await res.json()).toMatchObject({ error: "Missing or invalid access token" });
  });

  it("200 with a valid token, and /health stays open", async () => {
    const base = await oauthApp();
    const token = signJwt(rsa, liveClaims());
    const res = await call(base, "/deidentify", { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deidentifiedText: "mail [EMAIL]" });
    expect((await fetch(base + "/health")).status).toBe(200);
    expect((await fetch(base + "/entities")).status).toBe(401);
  });

  it("401 invalid_token for bad tokens, without saying why", async () => {
    const base = await oauthApp();
    const bad = [
      signJwt(rsa, liveClaims({ exp: 1000 })), // expired
      signJwt(rsa, liveClaims({ aud: "x" })), // wrong audience
      signJwt(createSigningKey("RS256", "rsa-1"), liveClaims()), // wrong key
      "not.a.jwt",
    ];
    for (const t of bad) {
      const res = await call(base, "/deidentify", { authorization: `Bearer ${t}` });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
      expect(JSON.stringify(await res.json())).not.toMatch(/expired|audience|signature/i);
    }
  });

  it("a plain string that is not JWT-shaped is rejected without calling the verifier", async () => {
    const base = await oauthApp();
    const res = await call(base, "/deidentify", { authorization: "Bearer secret" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="de-idfr-svc"');
  });

  it("403 insufficient_scope names the scope that is missing", async () => {
    const base = await oauthApp({ requiredScopes: ["deidfr:write"] });
    const token = signJwt(rsa, liveClaims({ scope: "deidfr:read" }));
    const res = await call(base, "/deidentify", { authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain('error="insufficient_scope", scope="deidfr:write"');
    expect(await res.json()).toMatchObject({ error: "Insufficient scope" });
  });

  it("503 with Retry-After when the identity provider cannot be reached", async () => {
    const base = await oauthApp({
      fetchJwks: async () => {
        throw new Error("down");
      },
    });
    const res = await call(base, "/deidentify", { authorization: `Bearer ${signJwt(rsa, liveClaims())}` });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  it("passes unexpected verifier crashes to the error handler (500)", async () => {
    const base = await start({
      tokenVerifier: async () => {
        throw new Error("boom");
      },
    });
    const res = await call(base, "/deidentify", { authorization: `Bearer a.b.c` });
    expect(res.status).toBe(500);
  });

  it("can be combined with API keys: either credential works", async () => {
    const base = await oauthApp({}, { apiKeys: ["static-key"] });
    const token = signJwt(rsa, liveClaims());
    expect((await call(base, "/deidentify", { authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await call(base, "/deidentify", { "x-api-key": "static-key" })).status).toBe(200);
    expect((await call(base, "/deidentify", { authorization: "Bearer static-key" })).status).toBe(200);
    const none = await call(base, "/deidentify", { "x-api-key": "wrong" });
    expect(none.status).toBe(401);
    expect(await none.json()).toMatchObject({ error: "Missing or invalid credentials" });
  });

  it("logs who called (the token subject) and why a token was refused, never the token itself", async () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (_l: LogLevel, line: string) => lines.push(line) });
    const base = await oauthApp({}, { logger });
    const good = signJwt(rsa, liveClaims({ sub: "billing-service" }));
    const expired = signJwt(rsa, liveClaims({ exp: 1000 }));
    await call(base, "/deidentify", { authorization: `Bearer ${good}` });
    await call(base, "/deidentify", { authorization: `Bearer ${expired}` });
    const log = lines.join("\n");
    expect(log).toContain("subject=billing-service");
    expect(log).toContain("Access token rejected");
    expect(log).toContain("reason=Token expired");
    expect(log).not.toContain(good);
    expect(log).not.toContain(expired);
    expect(log).not.toContain(good.split(".")[2]);
  });
});

// ---- Configuration ----------------------------------------------------------------------------

describe("OAuth settings", () => {
  it("is off by default", () => {
    expect(loadSettings({}).oauth).toBeUndefined();
  });

  it("derives the JWKS address from the issuer and parses scopes", () => {
    const s = loadSettings({
      OAUTH_ISSUER: "https://idp.example.com/",
      OAUTH_AUDIENCE: "de-idfr-svc",
      OAUTH_REQUIRED_SCOPES: "deidfr:read, deidfr:write",
    });
    expect(s.oauth).toEqual({
      issuer: "https://idp.example.com/",
      audience: "de-idfr-svc",
      jwksUri: "https://idp.example.com/.well-known/jwks.json",
      requiredScopes: ["deidfr:read", "deidfr:write"],
    });
  });

  it("accepts an explicit JWKS address and plain http for localhost", () => {
    const s = loadSettings({
      OAUTH_ISSUER: "http://localhost:4000",
      OAUTH_AUDIENCE: "a",
      OAUTH_JWKS_URI: "http://127.0.0.1:4000/keys",
    });
    expect(s.oauth?.jwksUri).toBe("http://127.0.0.1:4000/keys");
  });

  it("fails fast on incomplete or unsafe configuration", () => {
    expect(() => loadSettings({ OAUTH_AUDIENCE: "a" })).toThrow(/only used together with OAUTH_ISSUER/);
    expect(() => loadSettings({ OAUTH_ISSUER: "https://idp.example.com" })).toThrow(
      /OAUTH_AUDIENCE is required/
    );
    expect(() => loadSettings({ OAUTH_ISSUER: "not a url", OAUTH_AUDIENCE: "a" })).toThrow(/full URL/);
    expect(() => loadSettings({ OAUTH_ISSUER: "http://idp.example.com", OAUTH_AUDIENCE: "a" })).toThrow(
      /must use https/
    );
    expect(() =>
      loadSettings({
        OAUTH_ISSUER: "https://idp.example.com",
        OAUTH_AUDIENCE: "a",
        OAUTH_JWKS_URI: "http://evil.example/k",
      })
    ).toThrow(/OAUTH_JWKS_URI must use https/);
  });
});

// ---- End to end against the local mock identity provider ---------------------------------------

async function freePort(): Promise<number> {
  const s = createServer().listen(0);
  await new Promise((r) => s.once("listening", r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

async function startMock() {
  const port = await freePort();
  const mock = createMockOAuthServer({ port });
  mock.listen(port);
  await new Promise((r) => mock.once("listening", r));
  servers.push(mock);
  return mock;
}

const tokenRequest = (
  mock: { issuer: string },
  params: Record<string, string>,
  headers: Record<string, string> = {}
) =>
  fetch(`${mock.issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(params),
  });

const basic = (id: string, secret: string) => ({
  authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
});

describe("end to end with the mock identity provider", () => {
  it("issues a token that the service accepts, using the real JWKS download", async () => {
    const mock = await startMock();
    const base = await start({
      tokenVerifier: createTokenVerifier({
        issuer: mock.issuer,
        audience: "de-idfr-svc",
        jwksUri: `${mock.issuer}/.well-known/jwks.json`,
        requiredScopes: ["deidfr:write"],
      }),
    });

    const tokenRes = await tokenRequest(
      mock,
      { grant_type: "client_credentials" },
      basic("deidfr-client", "deidfr-secret")
    );
    expect(tokenRes.status).toBe(200);
    const body = await tokenRes.json();
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "deidfr:read deidfr:write" });

    const ok = await call(base, "/deidentify", { authorization: `Bearer ${body.access_token}` });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ deidentifiedText: "mail [EMAIL]" });

    // Same token, different identity provider key set: rejected by a service that trusts someone else.
    const other = await start({
      tokenVerifier: createTokenVerifier({
        issuer: mock.issuer,
        audience: "de-idfr-svc",
        jwksUri: "unused",
        fetchJwks: async () => ({ keys: [createSigningKey("RS256", mock.kid).jwk] }),
      }),
    });
    expect((await call(other, "/deidentify", { authorization: `Bearer ${body.access_token}` })).status).toBe(
      401
    );
  });

  it("the limited client authenticates but lacks the scope (403); bad tokens are 401", async () => {
    const mock = await startMock();
    const base = await start({
      tokenVerifier: createTokenVerifier({
        issuer: mock.issuer,
        audience: "de-idfr-svc",
        jwksUri: `${mock.issuer}/.well-known/jwks.json`,
        requiredScopes: ["deidfr:write"],
      }),
    });
    const get = async (id: string, secret: string) =>
      (await (await tokenRequest(mock, { grant_type: "client_credentials" }, basic(id, secret))).json())
        .access_token;
    const status = async (t: string) =>
      (await call(base, "/deidentify", { authorization: `Bearer ${t}` })).status;

    expect(await status(await get("limited-client", "limited-secret"))).toBe(403);
    expect(await status(await get("expired-client", "expired-secret"))).toBe(401);
    expect(await status(await get("wrong-audience-client", "wrong-audience-secret"))).toBe(401);
  });

  it("503 when the JWKS endpoint answers with an error", async () => {
    const mock = await startMock();
    const base = await start({
      tokenVerifier: createTokenVerifier({
        issuer: mock.issuer,
        audience: "de-idfr-svc",
        jwksUri: `${mock.issuer}/nope`,
      }),
    });
    const t = (
      await (
        await tokenRequest(
          mock,
          { grant_type: "client_credentials" },
          basic("deidfr-client", "deidfr-secret")
        )
      ).json()
    ).access_token;
    expect((await call(base, "/deidentify", { authorization: `Bearer ${t}` })).status).toBe(503);
  });

  describe("the mock token endpoint itself", () => {
    it("accepts credentials in the form body and a narrower scope", async () => {
      const mock = await startMock();
      const res = await tokenRequest(mock, {
        grant_type: "client_credentials",
        client_id: "deidfr-client",
        client_secret: "deidfr-secret",
        scope: "deidfr:read",
      });
      expect(await res.json()).toMatchObject({ scope: "deidfr:read" });
    });

    it("rejects bad credentials, unknown scopes, other grants and unknown routes", async () => {
      const mock = await startMock();
      const bad = await tokenRequest(
        mock,
        { grant_type: "client_credentials" },
        basic("deidfr-client", "wrong")
      );
      expect(bad.status).toBe(401);
      expect(await bad.json()).toEqual({ error: "invalid_client" });
      const unknown = await tokenRequest(mock, { grant_type: "client_credentials" }, basic("nobody", "x"));
      expect(unknown.status).toBe(401);

      const scope = await tokenRequest(
        mock,
        { grant_type: "client_credentials", scope: "admin" },
        basic("deidfr-client", "deidfr-secret")
      );
      expect(scope.status).toBe(400);
      expect(await scope.json()).toEqual({ error: "invalid_scope" });

      const grant = await tokenRequest(mock, { grant_type: "password" });
      expect(grant.status).toBe(400);
      expect(await grant.json()).toEqual({ error: "unsupported_grant_type" });

      expect((await fetch(`${mock.issuer}/missing`)).status).toBe(404);
    });

    it("publishes discovery metadata and keys", async () => {
      const mock = await startMock();
      const meta = await (await fetch(`${mock.issuer}/.well-known/openid-configuration`)).json();
      expect(meta).toMatchObject({ issuer: mock.issuer, token_endpoint: `${mock.issuer}/token` });
      const jwks = await (await fetch(meta.jwks_uri)).json();
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0]).toMatchObject({ kty: "RSA", kid: mock.kid, use: "sig" });
      expect(jwks.keys[0]).not.toHaveProperty("d"); // never the private half
    });
  });
});
