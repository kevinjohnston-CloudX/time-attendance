import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generatePeriodsForTenant, generatePeriodsForRuleSet } from "@/lib/pay-period-utils";

/**
 * Nightly cron: ensure every tenant (and every rule set with its own schedule)
 * has at least 2 future OPEN pay periods.
 * Secured with CRON_SECRET.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Tenant-level periods (legacy / fallback for rule sets with no own schedule)
  const tenants = await db.tenant.findMany({
    where: { payPeriodAnchorDate: { not: null } },
    select: { id: true },
  });

  const tenantResults = await Promise.allSettled(
    tenants.map((t) => generatePeriodsForTenant(t.id, 2))
  );

  // Rule-set-level periods for rule sets with their own schedule configured
  const ruleSets = await db.ruleSet.findMany({
    where: { payFrequency: { not: null }, payPeriodAnchorDate: { not: null } },
    select: { id: true, tenantId: true },
  });

  const ruleSetResults = await Promise.allSettled(
    ruleSets.map((rs) => generatePeriodsForRuleSet(rs.id, rs.tenantId, 2))
  );

  const generated =
    [...tenantResults, ...ruleSetResults].reduce(
      (sum, r) => sum + (r.status === "fulfilled" ? r.value : 0),
      0
    );
  const errors = [...tenantResults, ...ruleSetResults].filter((r) => r.status === "rejected").length;

  return NextResponse.json({
    generated,
    errors,
    tenants: tenants.length,
    ruleSets: ruleSets.length,
  });
}
