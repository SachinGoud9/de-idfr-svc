# Security notes

This service handles text that contains personal data, so the main rule is: **PII must not leak through the service itself.**

## What the service does

| Concern                   | Measure                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data leaving the process  | None. No outbound calls, no external APIs, no PII libraries.                                                                                                                                                                            |
| PII in logs               | Logs hold method, path, status, duration, request id, text length and counts only. Request/response bodies and query strings are never logged. Covered by a test.                                                                       |
| Error leakage             | Callers get a generic `500` plus a `requestId`. The real cause and stack go to the log only.                                                                                                                                            |
| Denial of service (size)  | Body capped (`BODY_LIMIT`, default 2 MB), text capped at 1,000,000 characters, batch capped at 1,000 records.                                                                                                                           |
| Denial of service (regex) | Patterns use bounded or linear forms. A test feeds 100k-character adversarial inputs to every rule and asserts a time limit.                                                                                                            |
| Abuse                     | Optional per-IP rate limit (`RATE_LIMIT_MAX`) with `429` and `Retry-After`.                                                                                                                                                             |
| Access control            | Optional API keys (`API_KEYS`) via `X-API-Key` or `Authorization: Bearer`. Compared as SHA-256 digests with `timingSafeEqual`. `/health` stays open.                                                                                    |
| OAuth 2.0 (optional)      | `OAUTH_ISSUER` + `OAUTH_AUDIENCE` enable JWT access-token checks: RS256/ES256 signatures against the provider's JWKS, `iss`, `aud`, `exp`, `nbf`, optional scopes. `none` and HMAC algorithms are rejected. Details in `docs/OAUTH.md`. |
| Input handling            | `415` for non-JSON bodies, `400` for malformed JSON or wrong types, unknown entity names rejected.                                                                                                                                      |
| Headers                   | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, strict CSP, `Cache-Control: no-store`. `X-Powered-By` removed.                                                                                                      |
| Log injection             | A caller-supplied `X-Request-Id` is only reused if it matches `^[A-Za-z0-9._-]{1,64}$`.                                                                                                                                                 |
| Container                 | Multi-stage build, runs as the non-root `node` user, production dependencies only.                                                                                                                                                      |

## What it does not do

- **Detection is pattern-based.** It will miss unusual formats and occasionally mask look-alikes (see the README table). Treat it as a first line of defence and review output before sharing sensitive data.
- **No TLS.** Terminate TLS at a reverse proxy or load balancer. Set `TRUST_PROXY=true` when behind one so rate limiting sees real client IPs.
- **Rate limiting is in memory** and per instance. Behind several instances, enforce limits at the gateway.
- **API keys are static.** For anything beyond internal use, use OAuth (`OAUTH_ISSUER`) or put the service behind your gateway.
- **Tokens are validated, not revoked.** A signed token stays valid until it expires, even if the provider revokes it. Keep token lifetimes short (minutes, not days).
- **Scopes are service-wide.** `OAUTH_REQUIRED_SCOPES` applies to every endpoint except `/health`. There are no per-route scopes.

## Reporting a problem

Open an issue without including real personal data in the report.
