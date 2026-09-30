import { db } from "@/lib/db";

/**
 * Finds the login someone typed, ignoring capitals: "NJ-Security@x.com" and
 * "nj-security@x.com" are the same address, as every mail provider treats them.
 *
 * Plain SQL on purpose. Prisma's `mode: "insensitive"` runs ILIKE, where a typed
 * % or _ is a wildcard, so "nj%@x.com" would match a real account.
 *
 * A few logins differ only by capitals. For those the exact spelling wins, then
 * the all lowercase one, and if neither matches nobody is signed in rather than
 * guessing between two people.
 */
export async function findLoginUserId(
  typed: string,
  match: { email?: boolean; username?: boolean },
): Promise<string | null> {
  const value = typed.trim();
  if (!value || (!match.email && !match.username)) return null;

  const byEmail = match.email ?? false;
  const byUsername = match.username ?? false;
  const rows = await db.$queryRaw<{ id: string; email: string | null; username: string | null }[]>`
    SELECT id, email, username FROM users
    WHERE (${byEmail}::boolean AND lower(email) = lower(${value}::text))
       OR (${byUsername}::boolean AND lower(username) = lower(${value}::text))
    LIMIT 5`;

  if (rows.length <= 1) return rows[0]?.id ?? null;
  const spelled = (s: string) =>
    rows.filter((r) => (byEmail && r.email === s) || (byUsername && r.username === s));
  const exact = spelled(value);
  if (exact.length === 1) return exact[0].id;
  const lower = spelled(value.toLowerCase());
  return lower.length === 1 ? lower[0].id : null;
}
