import { createMockOAuthServer, DEFAULT_CLIENTS } from "./mockOAuthServer";

// Run with: npm run mock-oauth
const port = Number(process.env.MOCK_OAUTH_PORT ?? 4000);
const audience = process.env.MOCK_OAUTH_AUDIENCE ?? "de-idfr-svc";
const ttlSeconds = Number(process.env.MOCK_OAUTH_TTL ?? 3600);

const server = createMockOAuthServer({ port, audience, ttlSeconds });
server.listen(port, () => {
  console.log(`Mock OAuth server (local testing only) on ${server.issuer}`);
  console.log(`  token endpoint : ${server.issuer}/token`);
  console.log(`  keys (JWKS)    : ${server.issuer}/.well-known/jwks.json`);
  console.log(`  audience       : ${audience}, token lifetime ${ttlSeconds}s`);
  console.log("  clients (client_id / client_secret):");
  for (const [id, c] of Object.entries(DEFAULT_CLIENTS)) {
    console.log(`    ${id} / ${c.secret}   scopes: ${c.scopes.join(" ")}`);
  }
  console.log("\nStart the service against it with:");
  console.log(`  $env:OAUTH_ISSUER="${server.issuer}"; $env:OAUTH_AUDIENCE="${audience}"; npm run dev`);
});
