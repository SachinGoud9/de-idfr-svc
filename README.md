# De-identification Service

A small Node.js / TypeScript service that finds and masks common PII in free text using
**regular expressions plus custom validation only**. No external APIs, no PII libraries, no text leaves the process.

## Setup

Requires Node.js 18+.

```bash
npm install
npm test                # automated tests (vitest)
npm run test:coverage   # same, with a coverage report and thresholds
npm run lint            # eslint
npm run format:check    # prettier
npm run typecheck       # tsc --noEmit
npm run dev             # start with tsx on http://localhost:3000
npm run build && npm start   # compiled
docker build -t de-idfr-svc . && docker run -p 3000:3000 de-idfr-svc
```

Try it:

```bash
curl -s localhost:3000/deidentify -H "content-type: application/json" \
  -d '{"text":"Contact john.doe@example.com at +1-415-555-0134"}'
```

### Configuration

Set as environment variables, or in a local `.env` file (loaded automatically on Node 20.12+). Everything is
validated at startup, and a bad value stops the service with a clear message. See [.env.example](.env.example).

| Variable                | Default                           | Meaning                                                                                               |
| ----------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PORT`                  | `3000`                            | Listen port                                                                                           |
| `LOG_REQUESTS`          | `true`                            | One log line when a request arrives and one when it finishes                                          |
| `LOG_FORMAT`            | `text`                            | `text` for people, `json` for log collectors                                                          |
| `BODY_LIMIT`            | `2mb`                             | Max request body (`512kb`, `2mb`, ...)                                                                |
| `API_KEYS`              | _(empty)_                         | Comma-separated keys. If set, calls need `X-API-Key` or `Authorization: Bearer`. `/health` stays open |
| `OAUTH_ISSUER`          | _(none)_                          | Turns on OAuth 2.0 bearer-token checks. Expected `iss` claim, for example `https://idp.example.com/`  |
| `OAUTH_AUDIENCE`        | _(none)_                          | Required with `OAUTH_ISSUER`. Expected `aud` claim, this service's identifier at the provider         |
| `OAUTH_JWKS_URI`        | issuer + `/.well-known/jwks.json` | Where the provider publishes its public signing keys                                                  |
| `OAUTH_REQUIRED_SCOPES` | _(none)_                          | Scopes every token must carry (space or comma separated), for example `deidfr:write`                  |
| `RATE_LIMIT_MAX`        | `0` (off)                         | Max requests per client IP per window                                                                 |
| `RATE_LIMIT_WINDOW_MS`  | `60000`                           | Rate limit window                                                                                     |
| `TRUST_PROXY`           | `false`                           | Set `true` behind a reverse proxy so limits use the real client IP                                    |
| `CUSTOM_RULES_FILE`     | _(none)_                          | Path to a JSON rules file, see below                                                                  |

**OAuth 2.0.** To accept signed access tokens from an identity provider, set `OAUTH_ISSUER` and `OAUTH_AUDIENCE` in
`.env` (restart afterwards):

```
OAUTH_ISSUER=http://localhost:4000
OAUTH_AUDIENCE=de-idfr-svc
OAUTH_REQUIRED_SCOPES=deidfr:write
```

The values above work with the local test provider (`npm run mock-oauth`). Step-by-step testing in Postman, including
how to save the token in a variable or paste it directly, is in [docs/OAUTH.md](docs/OAUTH.md).

Logs contain method, path, status, duration, request id and counts only, never request/response bodies or query
strings, since those contain PII. More in [SECURITY.md](SECURITY.md). The full API contract is in
[openapi.yaml](openapi.yaml). How AI was used, and where it was wrong, is in [docs/AI_USAGE.md](docs/AI_USAGE.md).

## API

### `POST /deidentify`

```json
{ "text": "Contact john.doe@example.com at +1-415-555-0134", "entities": ["EMAIL", "PHONE"] }
```

```json
{ "deidentifiedText": "Contact [EMAIL] at [PHONE]", "entitiesDetected": { "EMAIL": 1, "PHONE": 1 } }
```

- `text` (string, required; may be empty; max 1,000,000 chars).
- `entities` (optional, non-empty array of names, case-insensitive). **Default when omitted: every core entity
  (EMAIL, PHONE, SSN, DATE_OF_BIRTH, CREDIT_CARD, IP_ADDRESS)**. `NAME` is opt-in because it is context-based and
  higher risk of false positives. Custom rules are on by default unless `defaultEnabled: false`.
- `entitiesDetected` lists only entity types actually found.
- Errors are always JSON `{"error": "...", "requestId": "..."}`: `400` missing/non-string text, bad/unknown entities,
  malformed JSON; `401` bad or missing credentials; `403` token lacks a required scope; `503` token signing keys could not be loaded; `404` unknown route; `413` body too large; `415` not
  `application/json`; `429` rate limited (with `Retry-After`); `500` generic, details only in the server log.
- Every response carries an `X-Request-Id` header, which also appears in the log lines for that request.

### `POST /deidentify/batch`

```json
{ "records": [{ "id": "r1", "text": "a@b.com" }, "plain string also allowed"], "entities": ["EMAIL"] }
```

Returns `{ "results": [ { "id": "r1", "deidentifiedText": "[EMAIL]", "entitiesDetected": {"EMAIL":1} }, ... ] }`
(max 1000 records; any invalid record rejects the whole request with 400 naming the index).

### `GET /entities`, `GET /health`

### As a library

```ts
import { DeidentificationService } from "./src";
new DeidentificationService().deidentify("DOB: 1990-05-12", { entities: ["DATE_OF_BIRTH"] });
```

## Detection rules and limitations

| Entity          | Rule                                                                                                                                                                                                                                                                                                                                                              | Validation                                                                                 | Known limitations                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EMAIL           | `local@domain.tld`; local part is letters, digits and `. _ % + -`, plus apostrophes inside it (`o'brien@x.com`); ASCII domain, TLD of 2+ letters                                                                                                                                                                                                                  | none needed                                                                                | Internationalised (IDN/Unicode) addresses, quoted local parts and comments are not detected. `user@localhost` is ignored. **Other RFC 5322 specials (`! = / ?` ...) are not accepted on purpose**, because they would swallow surrounding text (`email=a@b.com` must stay `email=[EMAIL]`). The cost: `joh!n@example.com` becomes `joh![EMAIL]`.                                                          |
| PHONE           | (a) `+` international: any 1-3 digit country code, 8-15 digits total, space/dot/dash/parens separators; (b) the same with a `00` exit prefix and separators between groups (`0044 20 7946 0958`); (c) US/Canada `(415) 555-0134`, `415-555-0134`, `415.555.0134`, optional leading `1`; (d) bare 10 digits **only** after a label such as `Phone:`/`tel`/`mobile` | NANP area code and exchange must start 2-9; E.164 length (15 digits max)                   | Country codes are not checked against a list of assigned codes, and there is no per-country numbering-plan validation (that needs a library like libphonenumber, which this project avoids). Bare digit strings without a label are deliberately _not_ matched (false-positive risk: order numbers, IDs). International numbers without `+` or `00` are missed. Extensions (`x123`) are left in the text. |
| SSN             | `XXX-XX-XXXX`                                                                                                                                                                                                                                                                                                                                                     | Rejects area 000/666/900-999, group 00, serial 0000                                        | Only the dashed format; undashed `123456789` is not detected. Any valid-looking dashed number is masked even if it is not really an SSN.                                                                                                                                                                                                                                                                  |
| DATE_OF_BIRTH   | A birth label (`DOB`, `D.O.B.`, `Date of Birth`, `Birthdate`, `Birthday`, `Born (on)`) followed by a date: `1990-05-12`, `05/12/1990`, `12.05.1990`, `May 12, 1990`, `12 May 1990`                                                                                                                                                                                | Real calendar date (leap-aware), year 1900-current                                         | Only the date is replaced, the label is kept. Dates without a birth label are never matched. Ambiguous `05/12/1990` is accepted if valid as either MDY or DMY. Labels in other languages, two-digit years, and the label on a different line than the date are not handled.                                                                                                                               |
| CREDIT_CARD     | 13-19 digits: contiguous, `4-4-4-n` with one consistent separator (space or dash), or Amex `4-6-5`                                                                                                                                                                                                                                                                | Luhn checksum **and** issuer prefix/length (Visa, Mastercard, Amex, Discover, JCB, Diners) | Cards with irregular grouping are missed. Unknown issuers (e.g. UnionPay, Maestro) are not masked. A random number that happens to pass Luhn and prefix will be masked (about 1 in 10 of those that match the shape).                                                                                                                                                                                     |
| IP_ADDRESS      | Dotted-quad IPv4, octets 0-255, no leading zeros                                                                                                                                                                                                                                                                                                                  | Octet range                                                                                | IPv6 not supported. Version strings like `1.2.3.4` are indistinguishable from IPs and will be masked.                                                                                                                                                                                                                                                                                                     |
| NAME _(opt-in)_ | Capitalised 1-4 words after `Name:`, `Full Name:`, `Patient Name:`, `Customer Name:` (colon required, same line)                                                                                                                                                                                                                                                  | Unicode letters                                                                            | Names without a label are never detected (the spec example intentionally leaves "John Doe" alone). Lower-case names and labels like `Dear Mr. X` are missed.                                                                                                                                                                                                                                              |

General: all detection is pattern-based, so it has **false negatives** by design (unusual formats) and a few
unavoidable **false positives**. It is a first line of defence, not a compliance guarantee: review output before
sharing sensitive data.

## Design

```
src/
  types.ts        Rule / Span interfaces
  rules/          one file per entity; each exports a declarative Rule (regex + optional validate())
  registry.ts     holds rules, resolves defaults, entity lookup
  detector.ts     DETECTION: runs rules -> candidate spans -> overlap resolution
  replacer.ts     REPLACEMENT: spans -> output text (pure, knows nothing about rules)
  service.ts      input validation + orchestration (single, batch)
  server.ts       Express routes, middleware order, error mapping
  middleware.ts   request id, security headers, request log, rate limit, API-key / OAuth auth, JSON-only
  oauth.ts        OAuth 2.0 access-token (JWT) verification against the provider's published keys
  settings.ts     environment variables, validated once at startup
  logger.ts       small text/JSON logger (metadata only, never bodies)
  config.ts       custom rules from JSON
  index.ts        process wiring: .env, settings, graceful shutdown on SIGTERM/SIGINT
tests/
  rules/          one test file per rule
  *.test.ts       service, server, settings, detector, fuzz and adversarial-input tests
```

Decisions and trade-offs:

- **Detect on original text, then replace by offsets.** Rules never see each other's placeholders, and replacement is
  done by slicing, not by chained `String.replace`, so unrelated text is copied byte-for-byte (including `\r\n`, tabs
  and Unicode). Spans are code-unit offsets; all matched values are ASCII so surrogate pairs cannot be split.
- **Overlaps are resolved explicitly:** higher priority wins, then longer, then earlier (CREDIT_CARD 100 > SSN 90 >
  EMAIL 80 > IP 70 > DOB 60 > NAME 50 > PHONE 40). Phone is lowest because its shape is the loosest.
- **Precision over recall for ambiguous numbers.** Context-free 10-digit numbers are not phones; dates need a birth
  label; cards need Luhn + issuer. Masking too little is a risk too, so this is a documented, deliberate choice.
- **Declarative rules.** Adding an entity means registering a `Rule`; the detector/replacer/service do not change.
- **Regex safety.** Patterns use bounded quantifiers or simple linear forms and lookbehind anchors to avoid
  backtracking blowups; input is capped at 1M chars and bodies at 2 MB. A test runs every rule against 100k-character
  adversarial inputs and asserts a time limit.
- **Overlap resolution is O(n log n).** Accepted spans stay sorted and non-overlapping, so a new span only needs to be
  checked against its two neighbours. The first version compared against every accepted span (O(n²)); on a 380k-character
  text with 40,000 matches, de-identification dropped from about 1.2 s to 0.15–0.3 s. A test compares it with the brute-force version on random spans.
- **Hardening is built in, not bolted on.** Request ids, security headers, optional API keys and rate limiting, JSON-only
  bodies, PII-free logs and generic 500s. No extra dependencies. See [SECURITY.md](SECURITY.md).
- **Verified three ways:** per-rule unit tests, seeded fuzz tests (output is stable when re-run, and the only change
  to text is span → placeholder), and `npm run check` (types, lint, format, coverage thresholds) in CI.
- Whole-batch failure on one bad record keeps the contract simple; per-record errors would be an easy extension.

### Custom rules

Set `CUSTOM_RULES_FILE=rules.json`:

```json
{
  "customRules": [
    { "entity": "EMPLOYEE_ID", "pattern": "\\bEMP-\\d{6}\\b", "priority": 50 },
    {
      "entity": "MRN",
      "pattern": "MRN:\\s*(\\d+)",
      "group": 1,
      "placeholder": "<MRN>",
      "defaultEnabled": true
    }
  ]
}
```

Or in code: `service.registry.register({ entity, pattern, priority, validate })`.
(`group` replaces only that capture group.)

### Potential improvements

- Gazetteer / title-based name detection (`Dr.`, `Mr.`), addresses, IPv6, IBAN, passport numbers.
- Country-specific phone validation; i18n birth labels.
- Reversible tokenisation (consistent pseudonyms per value) as an option instead of fixed placeholders.
- Per-record errors in batch mode, streaming for very large inputs, request-level auth/rate limiting.
- An evaluation corpus with precision/recall tracking per rule.
