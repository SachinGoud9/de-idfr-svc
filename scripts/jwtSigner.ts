import { generateKeyPairSync, JsonWebKey, KeyObject, randomUUID, sign } from "node:crypto";

// Test-only helper: creates signing keys and signs JWTs. The service itself never signs anything.
// Used by the unit tests and by the local mock identity provider.

export interface SigningKey {
  alg: "RS256" | "ES256";
  kid: string;
  privateKey: KeyObject;
  /** Public half in JWKS form, ready to publish. */
  jwk: JsonWebKey & { kid: string; alg: string; use: string };
}

export function createSigningKey(
  alg: "RS256" | "ES256" = "RS256",
  kid = randomUUID().slice(0, 8)
): SigningKey {
  const { publicKey, privateKey } =
    alg === "RS256"
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg, use: "sig" };
  return { alg, kid, privateKey, jwk };
}

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

/** Signs `claims`. `header` entries override the defaults, which lets tests build deliberately bad tokens. */
export function signJwt(
  key: SigningKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {}
): string {
  const h = b64url({ alg: key.alg, typ: "JWT", kid: key.kid, ...header });
  const p = b64url(claims);
  const data = Buffer.from(`${h}.${p}`);
  const signature =
    key.alg === "ES256"
      ? sign("sha256", data, { key: key.privateKey, dsaEncoding: "ieee-p1363" })
      : sign("sha256", data, key.privateKey);
  return `${h}.${p}.${signature.toString("base64url")}`;
}
