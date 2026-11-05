import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextFunction, Request, RequestHandler, Response } from "express";
import { Logger } from "./logger";
import { TokenError, TokenVerifier } from "./oauth";

declare module "express-serve-static-core" {
  interface Request {
    id: string;
    // Set after a successful OAuth check: who the token was issued to and what it allows.
    auth?: { sub?: string; scopes: string[] };
  }
}

// Every request gets an id so a log line can be matched to the response a caller saw.
// We reuse the caller's X-Request-Id only if it is short and boring, to avoid log injection.
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header("x-request-id");
    req.id = incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  };
}

// Sensible defaults for an API that only returns JSON.
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    // The responses contain de-identified text, so keep them out of shared caches.
    res.setHeader("Cache-Control", "no-store");
    next();
  };
}

// One line when the request arrives, one when it finishes. Path only, never the query
// string or the body, since both can carry PII.
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    logger.info(`Called ${req.method} ${req.path}`, { requestId: req.id });
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info(`Completed ${req.method} ${req.path} with status ${res.statusCode}`, {
        requestId: req.id,
        durationMs: Number(ms.toFixed(1)),
        subject: req.auth?.sub,
      });
    });
    next();
  };
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

// Fixed-window limiter, kept in memory per client IP. Good enough for a single instance;
// behind several instances you would move this to a shared store or the API gateway.
export function rateLimit({ max, windowMs, now = Date.now }: RateLimitOptions): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();

  return (req, res, next) => {
    const t = now();
    if (t - lastSweep > windowMs) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      lastSweep = t;
    }
    const key = req.ip ?? "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many requests", requestId: req.id });
      return;
    }
    next();
  };
}

const digest = (s: string) => createHash("sha256").update(s).digest();

// Compares a supplied key with every configured key as fixed-length hashes, using
// timingSafeEqual and no early exit, so response time doesn't leak how much of a key
// was correct or which key matched.
function keyMatcher(keys: string[]): (supplied: string | undefined) => boolean {
  const hashed = keys.map(digest);
  return (supplied) => {
    if (!supplied) return false;
    const d = digest(supplied);
    let ok = false;
    for (const h of hashed) if (timingSafeEqual(d, h)) ok = true;
    return ok;
  };
}

export interface AuthOptions {
  /** Static API keys, sent as `X-API-Key` or `Authorization: Bearer`. */
  apiKeys?: string[];
  /** OAuth 2.0 access-token verifier (see oauth.ts). */
  verifier?: TokenVerifier;
  exemptPaths?: string[];
  logger?: Logger;
}

const looksLikeJwt = (t: string) => t.split(".").length === 3;

// Authentication. Accepts any configured credential: an API key, or an OAuth access token
// (a signed JWT in `Authorization: Bearer`). With neither configured it should not be mounted.
export function authenticate({
  apiKeys = [],
  verifier,
  exemptPaths = ["/health"],
  logger,
}: AuthOptions): RequestHandler {
  const keyOk = keyMatcher(apiKeys);
  const useKeys = apiKeys.length > 0;
  const what = verifier && useKeys ? "credentials" : verifier ? "access token" : "API key";

  const challenge = (params = "") => `Bearer realm="de-idfr-svc"${params}`;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (exemptPaths.includes(req.path)) return next();
    const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const headerKey = req.header("x-api-key");
    const reject = (params = "") => {
      res.setHeader("WWW-Authenticate", challenge(params));
      res.status(401).json({ error: `Missing or invalid ${what}`, requestId: req.id });
    };

    if (useKeys && (keyOk(headerKey) || keyOk(bearer))) return next();

    // Without a verifier, or when the bearer value isn't JWT-shaped, there is nothing more to try.
    if (!verifier || !bearer || !looksLikeJwt(bearer)) return reject();

    try {
      const claims = await verifier(bearer);
      req.auth = { sub: typeof claims.sub === "string" ? claims.sub : undefined, scopes: claims.scopes };
      return next();
    } catch (e) {
      if (!(e instanceof TokenError)) return next(e);
      // Log why, never the token. The caller only learns the RFC 6750 error code.
      logger?.warn("Access token rejected", { requestId: req.id, reason: e.message });
      if (e.code === "insufficient_scope") {
        res.setHeader(
          "WWW-Authenticate",
          challenge(`, error="insufficient_scope", scope="${e.missingScopes.join(" ")}"`)
        );
        res.status(403).json({ error: "Insufficient scope", requestId: req.id });
        return;
      }
      if (e.code === "jwks_unavailable") {
        logger?.error("Could not load token signing keys", { requestId: req.id, reason: e.message });
        res.setHeader("Retry-After", "5");
        res.status(503).json({ error: "Authentication temporarily unavailable", requestId: req.id });
        return;
      }
      return reject(', error="invalid_token"');
    }
  };
}

// Optional API key check, kept as its own entry point for callers that only use keys.
export function apiKeyAuth(keys: string[], exemptPaths: string[] = ["/health"]): RequestHandler {
  return authenticate({ apiKeys: keys, exemptPaths });
}

// express.json silently ignores bodies with the wrong content type, which would turn
// "forgot the header" into a confusing "text is required". Say what is actually wrong.
export function requireJson(): RequestHandler {
  return (req, res, next) => {
    if (req.method === "POST" && !req.is("application/json")) {
      res.status(415).json({ error: "Content-Type must be application/json", requestId: req.id });
      return;
    }
    next();
  };
}
