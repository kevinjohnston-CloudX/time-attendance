import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import type { PayFrequency } from "@prisma/client";
import { getPeriodContaining, periodAfter } from "@/lib/pay-period-math";

export { getPeriodContaining };

/**
 * The company level period that comes after the latest one, which is what
 * Generate creates, or null while no anchor date is saved. Rule set periods
 * are left out: they follow their own schedule.
 */
export async function nextTenantPeriod(
  tenantId: string
): Promise<{ startDate: Date; endDate: Date; frequency: PayFrequency } | null> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { payFrequency: true, payPeriodAnchorDate: true },
  });
  if (!tenant?.payPeriodAnchorDate) return null;

  const last = await db.payPeriod.findFirst({
    where: { tenantId, ruleSetId: null },
    orderBy: { endDate: "desc" },
    select: { endDate: true },
  });

  const frequency = tenant.payFrequency;
  const anchor = tenant.payPeriodAnchorDate;
  const next = last
    ? periodAfter(frequency, anchor, last.endDate)
    : getPeriodContaining(frequency, anchor, new Date());
  return { ...next, frequency };
}

/**
 * Ensure `targetFutureCount` future OPEN pay periods exist for the given tenant.
 * "Future" means startDate > today. Returns the number of periods created.
 * Idempotent — skips a period if it already exists.
 */
export async function generatePeriodsForTenant(
  tenantId: string,
  targetFutureCount = 2
): Promise<number> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { payFrequency: true, payPeriodAnchorDate: true },
  });

  if (!tenant?.payPeriodAnchorDate) return 0;

  const anchor = tenant.payPeriodAnchorDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let futureCount = await db.payPeriod.count({
    where: { tenantId, startDate: { gt: today } },
  });

  let created = 0;

  while (futureCount < targetFutureCount) {
    const last = await db.payPeriod.findFirst({
      where: { tenantId },
      orderBy: { endDate: "desc" },
    });

    const referenceDate = last ? last.endDate : today;
    const { startDate, endDate } = getPeriodContaining(tenant.payFrequency, anchor, referenceDate);

    const existing = await db.payPeriod.findFirst({
      where: { tenantId, startDate, endDate },
    });

    if (!existing) {
      const period = await db.payPeriod.create({
        data: { tenantId, startDate, endDate, status: "OPEN" },
      });

      await writeAuditLog({
        tenantId,
        actorId: null,
        entityType: "PAY_PERIOD",
        entityId: period.id,
        action: "CREATE",
        changes: { after: { startDate, endDate, frequency: tenant.payFrequency, source: "AUTO_CRON" } },
      });

      created++;
    }

    futureCount++;
  }

  return created;
}

/**
 * Ensure `targetFutureCount` future OPEN pay periods exist for the given rule set.
 * Only runs when the rule set has its own payFrequency and payPeriodAnchorDate configured.
 * Idempotent — skips a period if it already exists (checked by ruleSetId + dates).
 */
export async function generatePeriodsForRuleSet(
  ruleSetId: string,
  tenantId: string,
  targetFutureCount = 2
): Promise<number> {
  const ruleSet = await db.ruleSet.findUnique({
    where: { id: ruleSetId },
    select: { payFrequency: true, payPeriodAnchorDate: true },
  });

  if (!ruleSet?.payFrequency || !ruleSet.payPeriodAnchorDate) return 0;

  const anchor = ruleSet.payPeriodAnchorDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let futureCount = await db.payPeriod.count({
    where: { ruleSetId, startDate: { gt: today } },
  });

  let created = 0;

  while (futureCount < targetFutureCount) {
    const last = await db.payPeriod.findFirst({
      where: { ruleSetId },
      orderBy: { endDate: "desc" },
    });

    const referenceDate = last ? last.endDate : today;
    const { startDate, endDate } = getPeriodContaining(ruleSet.payFrequency, anchor, referenceDate);

    const existing = await db.payPeriod.findFirst({
      where: { ruleSetId, startDate, endDate },
    });

    if (!existing) {
      const period = await db.payPeriod.create({
        data: { tenantId, ruleSetId, startDate, endDate, status: "OPEN" },
      });

      await writeAuditLog({
        tenantId,
        actorId: null,
        entityType: "PAY_PERIOD",
        entityId: period.id,
        action: "CREATE",
        changes: { after: { startDate, endDate, frequency: ruleSet.payFrequency, ruleSetId, source: "AUTO_CRON" } },
      });

      created++;
    }

    futureCount++;
  }

  return created;
}
