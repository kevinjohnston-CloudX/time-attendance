import { db } from "@/lib/db";

export { cleanEmail, mailAddress } from "@/lib/email-address";

/**
 * A person's two sign in emails: the work one (`workEmail`) and the personal
 * one (`email`). Either signs them in, by password or by Google, so one
 * address can belong to only one person across both, ignoring capitals.
 * The database refuses a clash on every path (the users_login_email_unique
 * trigger); the check here runs first so the screen can say who has it.
 */

export interface EmailHolder {
  userId: string;
  name: string | null;
  tenantId: string | null;
  employeeCode: string | null;
}

/**
 * Who already holds each of these addresses, in either column, ignoring
 * capitals. Keyed by the lowercase address. `exceptUserId` leaves out the
 * person being edited, so their own addresses never count against them.
 */
export async function emailHolders(addresses: (string | null | undefined)[], exceptUserId?: string | null): Promise<Map<string, EmailHolder>> {
  const wanted = [...new Set(addresses.map((a) => (a ?? "").trim().toLowerCase()).filter(Boolean))];
  const found = new Map<string, EmailHolder>();
  if (wanted.length === 0) return found;
  const rows = await db.$queryRaw<{ id: string; name: string | null; email: string | null; workEmail: string | null; tenantId: string | null; employeeCode: string | null }[]>`
    SELECT u.id, u.name, u.email, u."workEmail", e."tenantId", e."employeeCode"
    FROM users u LEFT JOIN employees e ON e."userId" = u.id
    WHERE (lower(u.email) = ANY(${wanted}::text[]) OR lower(u."workEmail") = ANY(${wanted}::text[]))
      AND (${exceptUserId ?? null}::text IS NULL OR u.id <> ${exceptUserId ?? null}::text)`;
  for (const r of rows) {
    const holder = { userId: r.id, name: r.name, tenantId: r.tenantId, employeeCode: r.employeeCode };
    for (const a of [r.email, r.workEmail]) {
      const key = a?.toLowerCase();
      if (key && wanted.includes(key) && !found.has(key)) found.set(key, holder);
    }
  }
  return found;
}
