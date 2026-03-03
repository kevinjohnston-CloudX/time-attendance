import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generatePeriodsForTenant } from "@/lib/pay-period-utils";

/**
 * Nightly cron: ensure every tenant has at least 2 future OPEN pay periods.
 * Secured with CRON_SECRET. Vercel injects Authorization: Bearer {CRON_SECRET}
 * automatically when invoking its own cron jobs.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const tenants = await db.tenant.findMany({
    where: { payPeriodAnchorDate: { not: null } },
    select: { id: true },
  });

  const results = await Promise.allSettled(
    tenants.map((t) => generatePeriodsForTenant(t.id, 2))
  );

  const generated = results.reduce(
    (sum, r) => sum + (r.status === "fulfilled" ? r.value : 0),
    0
  );
  const errors = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({ generated, errors, tenants: tenants.length });
}
