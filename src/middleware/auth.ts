import { createHash, timingSafeEqual } from "node:crypto";
import { NextFunction, Request, RequestHandler, Response } from "express";
import { Logger } from "../utils/logger";
import { TokenError, TokenVerifier } from "../services/token-verifier.service";

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
