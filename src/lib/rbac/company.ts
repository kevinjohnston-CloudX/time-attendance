import { db } from "@/lib/db";

/**
 * The company a query is held to, when the caller has none.
 *
 * <p>A filter written `tenantId ?? undefined` or `tenantId ? { tenantId } : {}`
 * drops the company when it is missing, and then reads every company. Only a
 * super admin outside a company has none today, but a missing company has to
 * mean nothing, never everything (security audit 2026-11, M10). The build
 * check in scripts/check-company-scope.mjs refuses both forms.
 */
export const NO_COMPANY = "__no_company__";

/** The caller's company for a `where`, or one that matches nothing. */
export function ownCompany(tenantId: string | null | undefined): string {
  return tenantId ?? NO_COMPANY;
}

/** Answered as not found (guard.ts reads the name), so it says nothing about the other company. */
class NotOwnedError extends Error {
  name = "NotFoundError";
}

/**
 * The settings an id can point at, by the model that holds them. Each one
 * belongs to a company, and a record of one company pointing at another's
 * shows that company's names and rules in it (security audit 2026-11, M1).
 */
const OWNED = {
  site: "This site",
  department: "This department",
  ruleSet: "This rule set",
  shift: "This shift",
  holidayRule: "This holiday rule",
  payCategory: "This pay category",
  payType: "This pay type",
  leaveType: "This leave type",
  payCode: "This pay code",
  employee: "This person",
} as const;
export type OwnedSetting = keyof typeof OWNED;

/**
 * Every id given, of the caller's company, or not found. Leave a value out,
 * null or undefined, and it isn't checked: "not changed" and "cleared" need
 * nothing.
 */
export async function assertOwn(
  tenantId: string | null | undefined,
  ids: Partial<Record<OwnedSetting, string | null | undefined>>,
): Promise<void> {
  const company = ownCompany(tenantId);
  for (const [model, id] of Object.entries(ids) as [OwnedSetting, string | null | undefined][]) {
    if (!id) continue;
    const delegate = (db as unknown as Record<string, { findFirst(args: unknown): Promise<unknown> }>)[model];
    const found = await delegate.findFirst({ where: { id, tenantId: company }, select: { id: true } });
    if (!found) throw new NotOwnedError(`${OWNED[model]} isn't available. Reload the page and try again.`);
  }
}
