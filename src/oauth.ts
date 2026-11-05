import { createPublicKey, JsonWebKey, KeyObject, verify as cryptoVerify } from "node:crypto";

// OAuth 2.0 resource-server side: this service never issues tokens, it only checks the
// signed JWT access tokens that your identity provider (Okta, Auth0, Entra ID, Keycloak, ...)
// issued. Built on node:crypto so there is no extra dependency to audit.

export type SigningAlgorithm = "RS256" | "ES256";

export interface OAuthOptions {
  /** Expected `iss` claim. */
  issuer: string;
  /** Expected `aud` claim (this service's identifier at the identity provider). */
  audience: string;
  /** Where the provider publishes its public signing keys. */
  jwksUri: string;
  /** Every scope listed here must be present in the token. Empty = no scope check. */
  requiredScopes?: string[];
  /** Allow-list of signature algorithms. "none" and HMAC algorithms are never accepted. */
  algorithms?: SigningAlgorithm[];
  /** Accepted clock difference between this service and the provider. Default 30 s. */
  clockToleranceSec?: number;
  /** How long fetched keys are reused. Default 10 minutes. */
  jwksCacheMs?: number;
  /** Minimum gap between key refetches triggered by an unknown `kid`. Default 30 s. */
  jwksCooldownMs?: number;
  /** Replaceable for tests. Defaults to an HTTP GET of `jwksUri` with a 5 s timeout. */
  fetchJwks?: () => Promise<{ keys: JsonWebKey[] }>;
  now?: () => number;
}

export interface TokenClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  scopes: string[];
  [claim: string]: unknown;
}

export type TokenErrorCode = "invalid_token" | "insufficient_scope" | "jwks_unavailable";

export class TokenError extends Error {
  constructor(
    readonly code: TokenErrorCode,
    message: string,
    readonly missingScopes: string[] = []
  ) {
    super(message);
  }
}

export type TokenVerifier = (token: string) => Promise<TokenClaims>;

const b64urlToBuffer = (s: string) => Buffer.from(s, "base64url");

function parseJsonPart(part: string, what: string): Record<string, unknown> {
  try {
    const value = JSON.parse(b64urlToBuffer(part).toString("utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  } catch {
    // fall through
  }
  throw new TokenError("invalid_token", `Malformed token ${what}`);
}

// Providers differ: `scope` is a space-separated string (RFC 8693, Okta, Auth0, Keycloak),
// `scp` is an array (Okta) or a space-separated string (Entra ID).
function scopesOf(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const claim of [payload.scope, payload.scp]) {
    if (typeof claim === "string") out.push(...claim.split(/\s+/).filter(Boolean));
    else if (Array.isArray(claim)) out.push(...claim.filter((s): s is string => typeof s === "string"));
  }
  return out;
}

async function defaultFetchJwks(uri: string): Promise<{ keys: JsonWebKey[] }> {
  const res = await fetch(uri, {
    signal: AbortSignal.timeout(5000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`JWKS endpoint answered ${res.status}`);
  return (await res.json()) as { keys: JsonWebKey[] };
}

export function createTokenVerifier(options: OAuthOptions): TokenVerifier {
  const algorithms = options.algorithms ?? ["RS256", "ES256"];
  const toleranceSec = options.clockToleranceSec ?? 30;
  const cacheMs = options.jwksCacheMs ?? 10 * 60_000;
  const cooldownMs = options.jwksCooldownMs ?? 30_000;
  const now = options.now ?? Date.now;
  const fetchJwks = options.fetchJwks ?? (() => defaultFetchJwks(options.jwksUri));
  const required = options.requiredScopes ?? [];

  type CachedKey = { jwk: JsonWebKey & { kid?: string; use?: string }; key: KeyObject };
  let keys: CachedKey[] = [];
  let fetchedAt = -Infinity;
  let failedAt = -Infinity;
  let inflight: Promise<void> | undefined;

  // Concurrent callers share one fetch, so a burst of requests can't hammer the provider.
  function refresh(): Promise<void> {
    inflight ??= (async () => {
      try {
        const doc = await fetchJwks();
        if (!doc || !Array.isArray(doc.keys)) throw new Error("JWKS document has no keys array");
        const parsed: CachedKey[] = [];
        for (const jwk of doc.keys) {
          try {
            parsed.push({ jwk, key: createPublicKey({ key: jwk, format: "jwk" }) });
          } catch {
            // Skip keys we can't use (private-only, unsupported type) instead of failing all tokens.
          }
        }
        keys = parsed;
        fetchedAt = now();
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  }

  async function ensureKeys(maxAgeMs: number): Promise<void> {
    if (now() - fetchedAt < maxAgeMs) return;
    const unavailable = (why: string) =>
      new TokenError("jwks_unavailable", `Could not load signing keys: ${why}`);
    // After a failed fetch, back off so a provider outage doesn't add a slow call to every request.
    if (now() - failedAt < cooldownMs) {
      if (keys.length === 0) throw unavailable("provider unreachable, retrying shortly");
      return;
    }
    try {
      await refresh();
    } catch (e) {
      failedAt = now();
      // Provider briefly down: keep verifying with the keys we already have.
      if (keys.length === 0) throw unavailable((e as Error).message);
    }
  }

  const matches = (c: CachedKey, alg: SigningAlgorithm, kid: unknown) => {
    if (c.jwk.use !== undefined && c.jwk.use !== "sig") return false;
    const typeOk =
      alg === "RS256"
        ? c.jwk.kty === "RSA"
        : c.jwk.kty === "EC" && (c.jwk as { crv?: string }).crv === "P-256";
    if (!typeOk) return false;
    return kid === undefined ? true : c.jwk.kid === kid;
  };

  async function findKey(alg: SigningAlgorithm, kid: unknown): Promise<KeyObject> {
    await ensureKeys(cacheMs);
    let candidates = keys.filter((c) => matches(c, alg, kid));
    if (candidates.length === 0) {
      // Unknown kid usually means the provider rotated keys. Refetch, but not more than once per cooldown.
      await ensureKeys(cooldownMs);
      candidates = keys.filter((c) => matches(c, alg, kid));
    }
    // Without a kid we only proceed when there is exactly one possible key.
    if (candidates.length === 0 || (kid === undefined && candidates.length > 1)) {
      throw new TokenError("invalid_token", "No matching signing key");
    }
    return candidates[0].key;
  }

  return async (token: string): Promise<TokenClaims> => {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => p === "")) throw new TokenError("invalid_token", "Not a JWT");
    const [h, p, s] = parts;

    const header = parseJsonPart(h, "header");
    const alg = header.alg;
    if (typeof alg !== "string" || !(algorithms as string[]).includes(alg)) {
      throw new TokenError("invalid_token", "Unsupported signing algorithm");
    }
    const payload = parseJsonPart(p, "payload");

    const key = await findKey(alg as SigningAlgorithm, header.kid);
    const signed = Buffer.from(`${h}.${p}`);
    const signature = b64urlToBuffer(s);
    // JWS ECDSA signatures are raw r||s (IEEE P1363), not DER.
    const ok =
      alg === "ES256"
        ? cryptoVerify("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, signature)
        : cryptoVerify("sha256", signed, key, signature);
    if (!ok) throw new TokenError("invalid_token", "Bad signature");

    const nowSec = now() / 1000;
    if (payload.iss !== options.issuer) throw new TokenError("invalid_token", "Wrong issuer");
    const aud = payload.aud;
    const audOk = Array.isArray(aud) ? aud.includes(options.audience) : aud === options.audience;
    if (!audOk) throw new TokenError("invalid_token", "Wrong audience");
    if (typeof payload.exp !== "number") throw new TokenError("invalid_token", "Token has no expiry");
    if (payload.exp + toleranceSec <= nowSec) throw new TokenError("invalid_token", "Token expired");
    if (
      payload.nbf !== undefined &&
      (typeof payload.nbf !== "number" || payload.nbf - toleranceSec > nowSec)
    ) {
      throw new TokenError("invalid_token", "Token not valid yet");
    }

    const scopes = scopesOf(payload);
    const missing = required.filter((r) => !scopes.includes(r));
    if (missing.length > 0) {
      throw new TokenError("insufficient_scope", `Missing scope: ${missing.join(" ")}`, missing);
    }
    return { ...payload, scopes } as TokenClaims;
  };
}
