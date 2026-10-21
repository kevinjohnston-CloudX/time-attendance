import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { generatePeriodsForTenant, generatePeriodsForRuleSet } from "@/lib/pay-period-utils";

/**
 * Nightly cron: ensure every tenant (and every rule set with its own schedule)
 * has OPEN pay periods a year ahead (PERIOD_MONTHS_AHEAD), with approved time
 * off put on each new one.
 * Secured with CRON_SECRET.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Tenant-level periods — only needed for tenants that have at least one rule
  // set without its own pay schedule (those rule sets rely on the fallback).
  // If every rule set has payFrequency + payPeriodAnchorDate, skip tenant-level
  // generation entirely so no orphan periods are created alongside rule-set ones.
  const tenants = await db.tenant.findMany({
    where: {
      payPeriodAnchorDate: { not: null },
      ruleSets: {
        some: {
          OR: [{ payFrequency: null }, { payPeriodAnchorDate: null }],
        },
      },
    },
    select: { id: true },
  });

  const tenantResults = await Promise.allSettled(
    tenants.map((t) => generatePeriodsForTenant(t.id))
  );

  // Rule-set-level periods for rule sets with their own schedule configured
  const ruleSets = await db.ruleSet.findMany({
    where: { payFrequency: { not: null }, payPeriodAnchorDate: { not: null } },
    select: { id: true, tenantId: true },
  });

  const ruleSetResults = await Promise.allSettled(
    ruleSets.map((rs) => generatePeriodsForRuleSet(rs.id, rs.tenantId))
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

// The first run after the change makes about a year of periods for every rule set.
export const maxDuration = 300;
