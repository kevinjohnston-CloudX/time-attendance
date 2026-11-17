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
  /** The badge people know them by (Badge ID on their record). */
  wmsId: string | null;
  isActive: boolean | null;
  /** Which of their two emails holds the address. */
  field: "work" | "personal";
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
  const rows = await db.$queryRaw<{ id: string; name: string | null; email: string | null; workEmail: string | null; tenantId: string | null; employeeCode: string | null; wmsId: string | null; isActive: boolean | null }[]>`
    SELECT u.id, u.name, u.email, u."workEmail", e."tenantId", e."employeeCode", e."wmsId", e."isActive"
    FROM users u LEFT JOIN employees e ON e."userId" = u.id
    WHERE (lower(u.email) = ANY(${wanted}::text[]) OR lower(u."workEmail") = ANY(${wanted}::text[]))
      AND (${exceptUserId ?? null}::text IS NULL OR u.id <> ${exceptUserId ?? null}::text)`;
  for (const r of rows) {
    const holder = { userId: r.id, name: r.name, tenantId: r.tenantId, employeeCode: r.employeeCode, wmsId: r.wmsId, isActive: r.isActive };
    for (const [a, field] of [[r.workEmail, "work"], [r.email, "personal"]] as const) {
      const key = a?.toLowerCase();
      if (key && wanted.includes(key) && !found.has(key)) found.set(key, { ...holder, field });
    }
  }
  return found;
}

/**
 * The banner when an address is taken. Everyone sees the name of a holder in
 * their own company. `detailed` (admins and Payroll admins) also says which
 * record it is, so a duplicate or old record can be found: Badge ID, active or
 * not, and which of its two emails. A holder in another company is never
 * named, for anyone.
 */
export function emailTakenMessage(address: string, owner: EmailHolder, tenantId: string, detailed: boolean): string {
  const ours = owner.tenantId === tenantId;
  if (ours && detailed) {
    const badge = owner.wmsId ?? owner.employeeCode;
    const facts = [badge ? `Badge ID ${badge}` : null, owner.isActive === false ? "inactive" : "active"].filter(Boolean).join(", ");
    return `The email ${address} is already the ${owner.field} email of ${owner.name || "another person"} (${facts}).`;
  }
  const who = ours && owner.name ? owner.name : "another account";
  return `The email ${address} is already used by ${who}.`;
}
