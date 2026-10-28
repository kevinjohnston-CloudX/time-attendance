import crypto from "node:crypto";

/**
 * Webhook secrets, without storing any. An endpoint's secret is an HMAC of its
 * id and secretVersion under WEBHOOK_SIGNING_KEY (64 hex characters), so the
 * database never holds a secret to leak, and New secret only raises the version.
 *
 * <p>keyCheck fingerprints the signing key. An endpoint remembers the one it
 * was made under, and only a server holding that same key signs for it: a
 * local copy on the shared database, with its own key, leaves live's
 * endpoints alone rather than sending them signatures they would refuse.
 */

function signingKey(): Buffer | null {
  const hex = process.env.WEBHOOK_SIGNING_KEY?.trim();
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
}

const hmacHex = (key: crypto.BinaryLike, text: string) => crypto.createHmac("sha256", key).update(text).digest("hex");

/** Whether this server can make and sign webhooks at all. */
export function signingReady(): boolean {
  return signingKey() !== null;
}

/** This server's signing key, as a short fingerprint. Null without a key. */
export function currentKeyCheck(): string | null {
  const key = signingKey();
  return key ? hmacHex(key, "cloudtime-webhooks:key-check").slice(0, 16) : null;
}

/** Whether this server holds the key the endpoint was made under. */
export function canSignFor(endpoint: { keyCheck: string }): boolean {
  const check = currentKeyCheck();
  // A fingerprint, not a secret, so a plain comparison is fine.
  return check !== null && check === endpoint.keyCheck;
}

/** The secret a receiver checks this endpoint's signatures with. */
export function endpointSecret(endpointId: string, secretVersion: number): string {
  const key = signingKey();
  if (!key) throw new Error("Webhooks can't be set up on this server yet: its signing key isn't set.");
  return `whsec_${hmacHex(key, `endpoint:${endpointId}:${secretVersion}`)}`;
}

/** X-Webhook-Signature: the raw body signed with the endpoint's secret, as the ticketing system signs. */
export function signatureHeader(secret: string, body: string): string {
  return `sha256=${hmacHex(secret, body)}`;
}
