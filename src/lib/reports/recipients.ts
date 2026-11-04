import { db } from "@/lib/db";

/**
 * Who a scheduled report may be emailed to: an email on the record of someone
 * in the company (work or personal), or any address at one of the company's
 * own email domains, such as a distribution list. Anything else is outside the
 * company, and a schedule was a quiet way for pay and hours data to leave it
 * every day (security audit 2026-11, M8).
 *
 * <p>The company's domains are those of its people's work emails, never a
 * public provider's: Gmail is nobody's company.
 */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "yandex.com",
]);

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/** The addresses that may not receive this company's reports; empty when all may. */
export async function recipientsOutsideCompany(tenantId: string, recipients: string[]): Promise<string[]> {
  const wanted = [...new Set(recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return [];
  const people = await db.$queryRaw<{ email: string | null; workEmail: string | null }[]>`
    SELECT u.email, u."workEmail" FROM users u JOIN employees e ON e."userId" = u.id
    WHERE e."tenantId" = ${tenantId}`;
  const known = new Set<string>();
  const domains = new Set<string>();
  for (const p of people) {
    if (p.email) known.add(p.email.toLowerCase());
    if (p.workEmail) {
      known.add(p.workEmail.toLowerCase());
      const d = domainOf(p.workEmail);
      if (!PUBLIC_DOMAINS.has(d)) domains.add(d);
    }
  }
  return wanted.filter((r) => !known.has(r) && !domains.has(domainOf(r)));
}
