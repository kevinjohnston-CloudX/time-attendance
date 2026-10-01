import { db } from "@/lib/db";
import { periodContains } from "@/lib/pay-period-days";
import type { PunchSource, PunchState, PunchType } from "@prisma/client";

export async function getCurrentPunchState(employeeId: string): Promise<PunchState> {
  const [lastApproved, lastSystemReset] = await Promise.all([
    db.punch.findFirst({
      where: { employeeId, isApproved: true, isRejected: false, correctedById: null },
      orderBy: { roundedTime: "desc" },
      select: { stateAfter: true, roundedTime: true },
    }),
    db.punch.findFirst({
      where: { employeeId, isApproved: false, isRejected: false, source: "SYSTEM" },
      orderBy: { roundedTime: "desc" },
      select: { stateAfter: true, roundedTime: true },
    }),
  ]);

  if (!lastApproved && !lastSystemReset) return "OUT";
  if (!lastSystemReset) return lastApproved!.stateAfter;
  if (!lastApproved) return lastSystemReset.stateAfter;

  // Most recent punch (approved or system-reset) determines state
  return lastApproved.roundedTime >= lastSystemReset.roundedTime
    ? lastApproved.stateAfter
    : lastSystemReset.stateAfter;
}

export async function saveRejectedPunch(params: {
  employeeId: string;
  timesheetId: string | null;
  punchType: PunchType;
  source: PunchSource;
  stateBefore: PunchState;
  rejectionReason: string;
}): Promise<void> {
  const now = new Date();
  await db.punch.create({
    data: {
      employeeId: params.employeeId,
      timesheetId: params.timesheetId,
      punchType: params.punchType,
      punchTime: now,
      roundedTime: now,
      source: params.source,
      stateBefore: params.stateBefore,
      stateAfter: params.stateBefore, // state unchanged — punch was rejected
      isApproved: false,
      isRejected: true,
      rejectionReason: params.rejectionReason,
    },
  });
}

/**
 * Resolves the open pay period for an employee at a moment (now by default).
 * When the employee's rule set has its own pay period schedule, that period is
 * returned first. If none is found (e.g. the rule set has no schedule configured
 * yet), falls back to the tenant-level period (ruleSetId = null).
 *
 * <p>A period is matched by calendar day at the employee's site, not by its
 * stored instants (see pay-period-days): a punch at 7 AM on the Sunday a period
 * starts belongs to that period, though the period was stored as starting at
 * 1 PM. Pass the punch's own time, not the moment it arrived: a tablet flushing
 * its offline queue after midnight must not move yesterday's punch along.
 */
export async function findOpenPayPeriod(
  tenantId: string | null,
  ruleSetId?: string | null,
  opts: { at?: Date; timezone?: string | null } = {},
) {
  const at = opts.at ?? new Date();
  const timezone = opts.timezone || "America/New_York";
  // Candidates generously around the moment; the day check below decides.
  const near = { startDate: { lte: new Date(at.getTime() + 2 * 86_400_000) }, endDate: { gte: new Date(at.getTime() - 2 * 86_400_000) } };

  const tenantFrequency = async () =>
    tenantId
      ? (await db.tenant.findUnique({ where: { id: tenantId }, select: { payFrequency: true } }))?.payFrequency ?? "BIWEEKLY"
      : "BIWEEKLY";

  // Try rule-set-specific period first when ruleSetId is provided
  if (ruleSetId) {
    const rsPeriods = await db.payPeriod.findMany({
      where: { ruleSetId, status: "OPEN", ...near },
      include: { ruleSet: { select: { payFrequency: true } } },
      orderBy: { startDate: "desc" },
    });
    if (rsPeriods.length > 0) {
      const freq = rsPeriods[0].ruleSet?.payFrequency ?? (await tenantFrequency());
      const match = rsPeriods.find((p) => periodContains(p, freq, at, timezone));
      if (match) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { ruleSet: _rs, ...period } = match;
        return period;
      }
    }
  }

  // Fall back to tenant-level period (legacy / no rule-set schedule configured)
  const tenantPeriods = await db.payPeriod.findMany({
    where: { ...(tenantId && { tenantId }), ruleSetId: null, status: "OPEN", ...near },
    orderBy: { startDate: "desc" },
  });
  if (tenantPeriods.length === 0) return null;
  const freq = await tenantFrequency();
  return tenantPeriods.find((p) => periodContains(p, freq, at, timezone)) ?? null;
}
