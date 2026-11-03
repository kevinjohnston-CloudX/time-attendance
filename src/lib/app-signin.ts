import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sign in to the phone app through the phone's own browser.
 *
 * <p>Google refuses to sign anyone in inside an app's embedded browser, so the
 * app opens /api/app-signin in the real browser instead. Once the person is
 * signed in there, that route hands the app a short lived code through the
 * app's link scheme, and the app trades it for its own session with the
 * "app-signin" provider in auth.ts.
 *
 * <p>The code is bound to a secret the app made and never sent anywhere (the
 * same idea as OAuth's PKCE): the browser only ever sees its hash, so another
 * app that catches the link cannot use the code. Codes live two minutes and
 * are signed with APP_SIGNIN_SECRET, a secret of their own. With it unset
 * nothing is issued or accepted.
 */

/** The app's link scheme, registered in mobile-app/ (Info.plist and AndroidManifest.xml). */
export const APP_URL_SCHEME = "net.cloudxsystems.cloudtime";

const LIFETIME_MS = 2 * 60 * 1000;

/** base64url of a SHA-256: 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** What the app sends: 43 to 128 URL safe characters, as PKCE allows. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

function secret(): string | null {
  const value = process.env.APP_SIGNIN_SECRET;
  return value && value.length >= 32 ? value : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function isAppChallenge(value: unknown): value is string {
  return typeof value === "string" && CHALLENGE.test(value);
}

/** The hash the browser carries for a verifier. */
export function appChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** A code for this person and challenge, or null when sign in from the app is not set up. */
export function issueAppSigninCode(userId: string, challenge: string, now = Date.now()): string | null {
  const key = secret();
  if (!key || !userId || !isAppChallenge(challenge)) return null;
  const payload = Buffer.from(JSON.stringify({ u: userId, c: challenge, e: now + LIFETIME_MS })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/** The person a code was issued to, or null for anything forged, expired or used with the wrong verifier. */
export function redeemAppSigninCode(code: unknown, verifier: unknown, now = Date.now()): string | null {
  const key = secret();
  if (!key || typeof code !== "string" || typeof verifier !== "string" || !VERIFIER.test(verifier)) return null;
  const [payload, signature, extra] = code.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  const given = Buffer.from(signature);
  const wanted = Buffer.from(sign(payload, key));
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;

  let claims: { u?: unknown; c?: unknown; e?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.u !== "string" || typeof claims.e !== "number" || claims.e < now) return null;
  const challenge = Buffer.from(appChallengeFor(verifier));
  const bound = Buffer.from(String(claims.c));
  if (challenge.length !== bound.length || !timingSafeEqual(challenge, bound)) return null;
  return claims.u;
}
