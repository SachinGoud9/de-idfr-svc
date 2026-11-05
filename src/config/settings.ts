export interface Settings {
  port: number;
  logRequests: boolean;
  logFormat: "text" | "json";
  bodyLimit: string;
  // Max requests per client IP per window. 0 turns rate limiting off.
  rateLimitMax: number;
  rateLimitWindowMs: number;
  // If empty, the API is open. Otherwise every call (except /health) needs one of these keys.
  apiKeys: string[];
  customRulesFile?: string;
  trustProxy: boolean;
  // Set when OAUTH_ISSUER is configured. Calls then accept signed access tokens from that provider.
  oauth?: OAuthSettings;
}

export interface OAuthSettings {
  issuer: string;
  audience: string;
  jwksUri: string;
  requiredScopes: string[];
}

type Env = Record<string, string | undefined>;

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return n;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["true", "1", "yes"].includes(raw)) return true;
  if (["false", "0", "no"].includes(raw)) return false;
  throw new Error(`${name} must be true or false (got "${env[name]}")`);
}

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

function url(env: Env, name: string, value: string): URL {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${name} must be a full URL (got "${value}")`);
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLocalHost(u.hostname))) {
    // Keys or tokens fetched over plain http from a remote host could be swapped by anyone on the path.
    throw new Error(`${name} must use https (http is only allowed for localhost, got "${value}")`);
  }
  return u;
}

function oauthSettings(env: Env): OAuthSettings | undefined {
  const issuer = env.OAUTH_ISSUER?.trim();
  if (!issuer) {
    if (env.OAUTH_AUDIENCE?.trim() || env.OAUTH_JWKS_URI?.trim() || env.OAUTH_REQUIRED_SCOPES?.trim()) {
      throw new Error("OAUTH_* settings are only used together with OAUTH_ISSUER");
    }
    return undefined;
  }
  url(env, "OAUTH_ISSUER", issuer);
  const audience = env.OAUTH_AUDIENCE?.trim();
  if (!audience) throw new Error("OAUTH_AUDIENCE is required when OAUTH_ISSUER is set");
  // Most providers publish keys at <issuer>/.well-known/jwks.json. Override for those that don't.
  const jwksUri = env.OAUTH_JWKS_URI?.trim() || `${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`;
  url(env, "OAUTH_JWKS_URI", jwksUri);
  const requiredScopes = (env.OAUTH_REQUIRED_SCOPES ?? "").split(/[\s,]+/).filter(Boolean);
  return { issuer, audience, jwksUri, requiredScopes };
}

// Reads and validates configuration once at startup, so a typo fails fast with a clear
// message instead of showing up later as odd behaviour.
export function loadSettings(env: Env = process.env): Settings {
  const logFormat = (env.LOG_FORMAT ?? "text").trim().toLowerCase();
  if (logFormat !== "text" && logFormat !== "json") {
    throw new Error(`LOG_FORMAT must be "text" or "json" (got "${env.LOG_FORMAT}")`);
  }
  const bodyLimit = (env.BODY_LIMIT ?? "2mb").trim();
  if (!/^\d+(kb|mb)$/i.test(bodyLimit)) {
    throw new Error(`BODY_LIMIT must look like "512kb" or "2mb" (got "${env.BODY_LIMIT}")`);
  }
  return {
    port: int(env, "PORT", 3000, 0, 65535),
    logRequests: bool(env, "LOG_REQUESTS", true),
    logFormat,
    bodyLimit,
    rateLimitMax: int(env, "RATE_LIMIT_MAX", 0, 0, 1_000_000),
    rateLimitWindowMs: int(env, "RATE_LIMIT_WINDOW_MS", 60_000, 1000, 86_400_000),
    apiKeys: (env.API_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    customRulesFile: env.CUSTOM_RULES_FILE || undefined,
    trustProxy: bool(env, "TRUST_PROXY", false),
    oauth: oauthSettings(env),
  };
}
