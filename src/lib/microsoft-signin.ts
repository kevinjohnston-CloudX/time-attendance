/**
 * Sign in with Microsoft: who a Microsoft account may sign in as.
 *
 * <p>Work and school accounts from any company's Microsoft directory, and
 * personal Microsoft accounts (hotmail.com, outlook.com and the like), as
 * Juan chose on 2026-11-13: most people here with a Microsoft address have a
 * personal one. AZURE_AD_TENANT_ID narrows it ("organizations" for work
 * accounts only, or one directory's id); unset means "common", both kinds.
 *
 * <p>The same rule as Google: Microsoft never creates anybody. The account
 * signs in only as a person HR already registered, matched by their email or
 * work email, ignoring capitals.
 *
 * <p>Which address counts: the sign in name (preferred_username), which
 * Microsoft has verified. A work directory can only give its people sign in
 * names on domains it has proved it owns, and a personal account's sign in
 * name is the address Microsoft confirmed by code. The separate email claim is
 * NOT verified: any company's Microsoft administrator can type any address
 * into it, which is how another directory could pose as one of our people
 * (the "nOAuth" attack CXT guards against the same way). So the email claim
 * counts only when its domain is the sign in name's domain, and a differing
 * one refuses the sign in outright rather than being quietly ignored.
 */

export const MICROSOFT_PROVIDER = "microsoft-entra-id";

/** Microsoft's keys are set, so the button is offered and the provider loaded. */
export function microsoftSignInOffered(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.AZURE_AD_CLIENT_ID && env.AZURE_AD_CLIENT_SECRET);
}

/** Which Microsoft accounts: "common" (work and personal) unless narrowed. */
export function microsoftIssuer(env: NodeJS.ProcessEnv = process.env): string {
  const tenant = (env.AZURE_AD_TENANT_ID ?? "").trim() || "common";
  return `https://login.microsoftonline.com/${tenant}/v2.0`;
}

type Claims = { preferred_username?: unknown; email?: unknown } | null | undefined;

const text = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const domainOf = (address: string) => address.split("@")[1] ?? "";

/**
 * The addresses this Microsoft account may be matched by, the verified sign
 * in name first. Null when it must be refused: no usable sign in name, or an
 * email claim on another domain than the sign in name.
 */
export function microsoftAddresses(claims: Claims): string[] | null {
  const upn = text(claims?.preferred_username);
  const mail = text(claims?.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(upn)) return null;
  if (mail && domainOf(mail) !== domainOf(upn)) return null;
  return mail && mail !== upn ? [upn, mail] : [upn];
}

/** Where a refused sign in lands: the sign in page, saying why in plain words. */
export type SignInRefusal = "NotSetUp" | "Refused";
export function signInRefused(reason: SignInRefusal, provider: "google" | "microsoft"): string {
  return `/login?error=${reason}&with=${provider}`;
}
