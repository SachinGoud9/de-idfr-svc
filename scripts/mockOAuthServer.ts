import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { createSigningKey, signJwt } from "./jwtSigner";

// A tiny local OAuth 2.0 authorization server for testing. It supports only the client
// credentials grant (machine-to-machine), publishes its public keys as a JWKS, and signs
// tokens with a key generated at startup. NEVER use it outside local testing: the client
// secrets below are public and tokens stop verifying whenever it restarts.

export interface MockClient {
  secret: string;
  scopes: string[];
  /** Override claims to produce deliberately bad tokens. */
  claims?: () => Record<string, unknown>;
}

export interface MockOAuthOptions {
  port: number;
  audience?: string;
  ttlSeconds?: number;
}

export const DEFAULT_CLIENTS: Record<string, MockClient> = {
  "deidfr-client": { secret: "deidfr-secret", scopes: ["deidfr:read", "deidfr:write"] },
  "limited-client": { secret: "limited-secret", scopes: ["deidfr:read"] },
  // Tokens that must be rejected, one per failure mode:
  "expired-client": {
    secret: "expired-secret",
    scopes: ["deidfr:read", "deidfr:write"],
    claims: () => ({ exp: Math.floor(Date.now() / 1000) - 3600 }),
  },
  "wrong-audience-client": {
    secret: "wrong-audience-secret",
    scopes: ["deidfr:read", "deidfr:write"],
    claims: () => ({ aud: "some-other-api" }),
  },
};

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function createMockOAuthServer(
  options: MockOAuthOptions,
  clients = DEFAULT_CLIENTS
): Server & { issuer: string; kid: string } {
  const audience = options.audience ?? "de-idfr-svc";
  const ttl = options.ttlSeconds ?? 3600;
  const issuer = `http://localhost:${options.port}`;
  const key = createSigningKey("RS256", `mock-${randomUUID().slice(0, 8)}`);

  const server = createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];

    if (req.method === "GET" && path === "/.well-known/jwks.json") return json(res, 200, { keys: [key.jwk] });

    if (req.method === "GET" && path === "/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        grant_types_supported: ["client_credentials"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }

    if (req.method === "POST" && path === "/token") {
      const form = new URLSearchParams(await readBody(req));
      if (form.get("grant_type") !== "client_credentials") {
        return json(res, 400, { error: "unsupported_grant_type" });
      }
      // Clients may authenticate with HTTP Basic (Postman's default) or with form fields.
      let id = form.get("client_id") ?? "";
      let secret = form.get("client_secret") ?? "";
      const basic = req.headers.authorization?.match(/^Basic\s+(.+)$/i)?.[1];
      if (basic) {
        const decoded = Buffer.from(basic, "base64").toString("utf8");
        const i = decoded.indexOf(":");
        id = decodeURIComponent(decoded.slice(0, i));
        secret = decodeURIComponent(decoded.slice(i + 1));
      }
      const client = clients[id];
      if (!client || client.secret !== secret) {
        return json(
          res,
          401,
          { error: "invalid_client" },
          { "www-authenticate": 'Basic realm="mock-oauth"' }
        );
      }
      const requested = (form.get("scope") ?? "").split(/\s+/).filter(Boolean);
      if (requested.some((s) => !client.scopes.includes(s)))
        return json(res, 400, { error: "invalid_scope" });
      const granted = requested.length ? requested : client.scopes;

      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(key, {
        iss: issuer,
        sub: id,
        aud: audience,
        iat: now,
        exp: now + ttl,
        scope: granted.join(" "),
        client_id: id,
        ...client.claims?.(),
      });
      return json(res, 200, {
        access_token: token,
        token_type: "Bearer",
        expires_in: ttl,
        scope: granted.join(" "),
      });
    }

    json(res, 404, { error: "not_found" });
  }) as Server & { issuer: string; kid: string };

  server.issuer = issuer;
  // A new key id on every start, so a service that cached the previous key notices the rotation.
  server.kid = key.kid;
  return server;
}
