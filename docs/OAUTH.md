# OAuth 2.0 authentication

The service can act as an OAuth 2.0 **resource server**: callers present a signed access token (a JWT) in
`Authorization: Bearer <token>`, and the service checks it. The service never issues tokens. Your identity provider
(Okta, Auth0, Microsoft Entra ID, Keycloak, Cognito, ...) does that.

It is off unless `OAUTH_ISSUER` is set. It can run alongside `API_KEYS`, in which case either credential works.
`/health` is always open.

## What is checked on every request

| Check             | Rule                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Signature         | RS256 or ES256 only, verified with the provider's public key (matched by the token's `kid`). `none` and HMAC are refused. |
| `iss`             | Must equal `OAUTH_ISSUER` exactly.                                                                                        |
| `aud`             | Must equal `OAUTH_AUDIENCE` (a string, or one entry of a list).                                                           |
| `exp`             | Required. Expired tokens are refused, with 30 s of clock-drift allowance.                                                 |
| `nbf`             | If present, the token must already be valid (same 30 s allowance).                                                        |
| Scopes (optional) | Every scope in `OAUTH_REQUIRED_SCOPES` must be in the token's `scope` (space-separated) or `scp` (list) claim.            |

Public keys are downloaded from the provider's JWKS address, cached for 10 minutes, and re-downloaded (at most once
per 30 s) when a token names a key the service doesn't know, which is how key rotation is picked up. If the provider
is unreachable, the service keeps using the keys it already has.

## Settings

| Variable                | Required | Meaning                                                                                              |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OAUTH_ISSUER`          | yes      | The provider's issuer URL. Must be `https` (plain `http` only for localhost).                        |
| `OAUTH_AUDIENCE`        | yes      | This API's identifier at the provider.                                                               |
| `OAUTH_JWKS_URI`        | no       | Defaults to `<issuer>/.well-known/jwks.json`. Set it if your provider publishes keys somewhere else. |
| `OAUTH_REQUIRED_SCOPES` | no       | Scopes a token must carry, space or comma separated. Applies to every endpoint except `/health`.     |

A missing audience, a malformed URL, or an `http` address for a remote host stops the service at startup with a clear
message.

## Responses

| Situation                                      | Status | `WWW-Authenticate`                                      |
| ---------------------------------------------- | ------ | ------------------------------------------------------- |
| No credential                                  | 401    | `Bearer realm="de-idfr-svc"`                            |
| Token expired, wrong audience/issuer/signature | 401    | `Bearer realm="de-idfr-svc", error="invalid_token"`     |
| Valid token, missing a required scope          | 403    | `..., error="insufficient_scope", scope="deidfr:write"` |
| Provider's keys cannot be loaded               | 503    | none, but `Retry-After: 5`                              |

The response never says _why_ a token was refused (that would help an attacker). The reason is in the service log as
`Access token rejected ... reason=...`, together with the request id. Successful requests log `subject=<token sub>`.
Tokens are never logged.

---

# Testing it locally

You don't need a real identity provider. `npm run mock-oauth` starts a small local one that issues real, signed tokens.

> The mock is for local testing only. Its client secrets are public and its signing key is regenerated on every start.

## 1. Start the mock identity provider (terminal 1)

```powershell
cd path\to\de-idfr-svc
npm run mock-oauth
```

It listens on `http://localhost:4000` and prints its clients:

| client_id               | client_secret           | scopes                     | Use it to test                     |
| ----------------------- | ----------------------- | -------------------------- | ---------------------------------- |
| `deidfr-client`         | `deidfr-secret`         | `deidfr:read deidfr:write` | the happy path                     |
| `limited-client`        | `limited-secret`        | `deidfr:read`              | `403 insufficient_scope`           |
| `expired-client`        | `expired-secret`        | `deidfr:read deidfr:write` | `401`, token already expired       |
| `wrong-audience-client` | `wrong-audience-secret` | `deidfr:read deidfr:write` | `401`, token meant for another API |

Change the port, audience or token lifetime with `MOCK_OAUTH_PORT`, `MOCK_OAUTH_AUDIENCE`, `MOCK_OAUTH_TTL` (seconds).

## 2. Start the service with OAuth on (terminal 2)

Put the settings in the `.env` file in the project root. The service loads it at startup (Node 20.12 or newer):

```
OAUTH_ISSUER=http://localhost:4000
OAUTH_AUDIENCE=de-idfr-svc
OAUTH_REQUIRED_SCOPES=deidfr:write
```

Then start the service:

```powershell
cd path\to\de-idfr-svc
npm run dev
```

The startup log should say `auth=oauth`. (If you set `API_KEYS` too it says `auth=api-key+oauth`.)

Notes on `.env`:

- Settings are read once at startup, so restart the service after editing the file.
- A variable already set in your terminal wins over `.env`. If the service ignores your file, clear leftovers with
  `Remove-Item Env:OAUTH_ISSUER, Env:OAUTH_AUDIENCE, Env:OAUTH_REQUIRED_SCOPES`.
- To turn OAuth off again, put `#` in front of the three lines (or delete them) and restart.
- Don't ship these localhost values to production. Use your real provider's issuer and audience.

Prefer not to use the file? Set the same names for one terminal session only:

```powershell
$env:OAUTH_ISSUER="http://localhost:4000"
$env:OAUTH_AUDIENCE="de-idfr-svc"
$env:OAUTH_REQUIRED_SCOPES="deidfr:write"
npm run dev
```

## 3. Test with Postman

### Get a token the automatic way

1. Create a request: `POST http://localhost:3000/deidentify`, Body → raw → JSON: `{"text": "SSN 123-45-6789"}`.
2. Open the **Authorization** tab, Type **OAuth 2.0**, Add auth data to **Request Headers**.
3. Fill in:
   - Grant Type: **Client Credentials**
   - Access Token URL: `http://localhost:4000/token`
   - Client ID: `deidfr-client`
   - Client Secret: `deidfr-secret`
   - Client Authentication: **Send as Basic Auth header**
4. Click **Get New Access Token**, then **Use Token**, then **Send**.

### Get a token the manual way (Option B)

First request, "Get token": `POST http://localhost:4000/token`, Body → **x-www-form-urlencoded**:

| Key             | Value                |
| --------------- | -------------------- |
| `grant_type`    | `client_credentials` |
| `client_id`     | `deidfr-client`      |
| `client_secret` | `deidfr-secret`      |

Type the values by hand or paste them carefully. A trailing line break (Postman shows it as `↵`) becomes part of the
value, and the mock answers `401 {"error":"invalid_client"}`. The same goes for a stray `Authorization` header on this
request: it overrides the form fields.

The response is `{"access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600, "scope": "deidfr:read deidfr:write"}`.
Then use the token in one of two ways.

**B1. Save it in a variable (no copying).**

1. Save the "Get token" request inside a collection. Collection variables need a collection to live in.
2. Open its **Scripts** tab (called **Tests** in older Postman versions), choose **Post-response**, and paste:
   ```js
   pm.collectionVariables.set("token", pm.response.json().access_token);
   ```
3. Send the request. On success the variable `token` is set. If the response was not `200`, the script fails with an
   error in **Test Results** because `access_token` does not exist.
4. On the service request (`POST http://localhost:3000/deidentify`), open **Authorization**, choose **Bearer Token**
   and enter `{{token}}` as the token.

**B2. Paste the token directly.**

1. Copy the value of `access_token` from the response: only the long `eyJ...` string, without quotes, on one line.
2. On the service request, open **Authorization**, choose **Bearer Token** and paste it into the **Token** box.
   Alternatively add a header `Authorization` with the value `Bearer eyJ...` (the word `Bearer`, one space, the token).
   Use the tab or the header, not both.

Tokens from the mock last 1 hour (`MOCK_OAUTH_TTL`). After that the service answers `401`, so get a new token. With B1
send "Get token" again. With B2 copy and paste again. Restarting the mock also invalidates the old token.

### Expected results

All against `POST http://localhost:3000/deidentify` with `{"text": "SSN 123-45-6789"}`:

| #   | What you send                                          | Expected                                                                                                                                                    |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | no Authorization                                       | `401`, `Missing or invalid access token`, `WWW-Authenticate: Bearer realm=...`                                                                              |
| 2   | token from `deidfr-client`                             | `200`, `"deidentifiedText": "SSN [SSN]"`                                                                                                                    |
| 3   | token from `limited-client`                            | `403`, `Insufficient scope`, header names `scope="deidfr:write"`                                                                                            |
| 4   | token from `expired-client`                            | `401`, header has `error="invalid_token"`                                                                                                                   |
| 5   | token from `wrong-audience-client`                     | `401`, `error="invalid_token"`                                                                                                                              |
| 6   | `Bearer not.a.token`                                   | `401`, `error="invalid_token"`                                                                                                                              |
| 7   | a valid token with one character changed               | `401`, `error="invalid_token"` (signature no longer matches)                                                                                                |
| 8   | `GET /health`, no Authorization                        | `200`                                                                                                                                                       |
| 9   | `GET /entities`, no Authorization                      | `401`                                                                                                                                                       |
| 10  | restart the **mock**, fetch a **new** token, send it   | `200`. The new token names a key the service has not seen, so it re-downloads the keys (at most once per 30 s, so if you get a `401` wait 30 s and resend). |
| 11  | stop the **mock**, restart the service, send any token | `503` with `Retry-After: 5`, because the service cannot download the keys                                                                                   |

For case 4 you can also check the log in terminal 2: `Access token rejected requestId=... reason=Token expired`.
For case 3 the reason is `Missing scope: deidfr:write`. A successful call logs `subject=deidfr-client`.

To test expiry with a normal client, start the mock with a short lifetime (`$env:MOCK_OAUTH_TTL="5"`; the service allows
30 s of clock drift, so wait about 40 s).

## 4. Test with curl (PowerShell)

Use `curl.exe`, because plain `curl` is an alias for something else in PowerShell.

```powershell
# Get a token
$resp = curl.exe -s -u deidfr-client:deidfr-secret -d grant_type=client_credentials http://localhost:4000/token | ConvertFrom-Json
$token = $resp.access_token

# Call the service
curl.exe -i http://localhost:3000/deidentify -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d '{\"text\":\"SSN 123-45-6789\"}'

# No token (expect 401)
curl.exe -i http://localhost:3000/deidentify -H "Content-Type: application/json" -d '{\"text\":\"x\"}'
```

Look inside a token: the middle part is base64url JSON. In PowerShell:

```powershell
$p = $token.Split(".")[1].Replace("-","+").Replace("_","/"); $p += "=" * ((4 - $p.Length % 4) % 4)
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))
```

## 5. Automated tests

```powershell
npx vitest run tests/integration/oauth.test.ts   # 41 tests, about 2 seconds
npm run check                        # typecheck, lint, formatting, all tests with coverage thresholds
```

`tests/integration/oauth.test.ts` has three layers:

- **Verification rules** (`createTokenVerifier`): valid RS256 and ES256 tokens; expiry and clock drift; `nbf`; issuer and
  audience; forged signatures, tampered payloads, `alg: none`, HMAC, and RSA-key-as-EC-key confusion; malformed tokens;
  scopes; key caching, rotation and cooldown; provider outages.
- **HTTP behaviour**: status codes, `WWW-Authenticate` values, `/health` open, API key and OAuth together, and that logs
  contain the token's subject and the refusal reason but never the token.
- **End to end**: starts the real mock provider and a real service, downloads keys over HTTP, and checks the four mock
  clients.

---

# Using a real identity provider

Set the three values from your provider's API settings. The issuer and key address are in its discovery document
(`<issuer>/.well-known/openid-configuration`, fields `issuer` and `jwks_uri`).

| Provider        | `OAUTH_ISSUER`                                           | `OAUTH_AUDIENCE`                     | Notes                                                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth0           | `https://YOUR_TENANT.auth0.com/` (keep the trailing `/`) | the API Identifier you created       | Scopes arrive in the `scope` claim.                                                                                                                                                                                                      |
| Okta            | `https://YOUR_ORG.okta.com/oauth2/default`               | `api://default` or your custom value | JWKS is `.../oauth2/default/v1/keys`: set `OAUTH_JWKS_URI`.                                                                                                                                                                              |
| Keycloak        | `https://HOST/realms/REALM`                              | the client/audience you configured   | JWKS is `.../protocol/openid-connect/certs`: set `OAUTH_JWKS_URI`.                                                                                                                                                                       |
| Microsoft Entra | `https://login.microsoftonline.com/TENANT_ID/v2.0`       | `api://YOUR_APP_ID` or the app id    | JWKS is `https://login.microsoftonline.com/TENANT_ID/discovery/v2.0/keys`: set `OAUTH_JWKS_URI`. Scopes arrive in `scp` for user tokens, `roles` for app tokens (roles are not read, use scope-less checks or add an `scp`-style scope). |

The issuer must match the token's `iss` character for character, including a trailing slash. If every token gets
`401`, decode one (see above) and compare its `iss` and `aud` with your settings. The service log shows which check failed.

## Limits of this implementation

- Signature algorithms are RS256 and ES256 only. Providers configured for PS256, EdDSA or HS256 are not supported.
- No token revocation or introspection: a token stays valid until `exp`. Use short lifetimes.
- One scope list for the whole service, no per-endpoint scopes, and `roles`/`groups` claims are not interpreted.
- Only access tokens are validated. There is no login flow, session or refresh handling. Callers get tokens from the provider.
- The key cache is per process.
