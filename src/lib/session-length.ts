/**
 * How long a sign in lasts. A working day by default, so a sign in left open
 * on a shared warehouse computer does not outlive the shift; 30 days when the
 * person ticked Remember me, on their own computer or phone. Counted from the
 * sign in itself, not from the last click, so a remembered sign in still ends.
 *
 * <p>Edge safe: read by the proxy (auth.config.ts) and by auth.ts alike, so
 * both agree on when a sign in has ended.
 */
export const SIGN_IN_HOURS = 12;
export const REMEMBERED_DAYS = 30;

/** The longest any sign in can last: what the session cookie is set to. */
export const LONGEST_SIGN_IN_SECONDS = REMEMBERED_DAYS * 24 * 60 * 60;

/**
 * Set by the sign-in page just before Google sign in, which cannot carry
 * Remember me itself, and read once when Google sends the person back.
 */
export const REMEMBER_COOKIE = "cloudtime-remember";

type SignInStamp = Record<string, unknown> & { remember?: unknown; signedInAt?: unknown };

/**
 * Stamps a sign in made before this rule existed with the time it is first
 * seen, so it gets a working day from now rather than ending at once or
 * running for 30 days. Then answers whether the sign in has run out.
 */
export function signInEnded(token: SignInStamp, now = Date.now()): boolean {
  if (typeof token.signedInAt !== "number") token.signedInAt = now;
  const limit = token.remember === true ? REMEMBERED_DAYS * 24 * 60 * 60 * 1000 : SIGN_IN_HOURS * 60 * 60 * 1000;
  return now - (token.signedInAt as number) > limit;
}
