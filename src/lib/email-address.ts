/**
 * A person's two sign in emails, the work one (`workEmail`) and the personal
 * one (`email`): the small rules both the server and the browser need. Safe to
 * import anywhere; the lookups that read the database are in login-email.ts.
 */

/** A typed address, trimmed; empty means none. The work email is saved lowercase. */
export function cleanEmail(value: string | null | undefined, kind: "work" | "personal"): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return kind === "work" ? v.toLowerCase() : v;
}

/** Where mail to the person goes, and the one to show: the work email first, else the personal one. */
export function mailAddress(user: { email?: string | null; workEmail?: string | null } | null | undefined): string | null {
  return user?.workEmail || user?.email || null;
}
