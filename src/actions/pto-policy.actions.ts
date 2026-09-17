"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import {
  createPtoPolicySchema,
  updatePtoPolicySchema,
  assignSitePtoPolicySchema,
} from "@/lib/validators/pto-policy.schema";

// ─── Get all PTO policies for the tenant ─────────────────────────────────────

export const getPtoPolicies = withRBAC(
  "RULES_MANAGE",
  async ({ tenantId }, _input: void) => {
    const policies = await db.ptoPolicy.findMany({
      where: { tenantId: tenantId! },
      orderBy: { name: "asc" },
      include: {
        leaveType: { select: { id: true, name: true, category: true } },
        rules: {
          orderBy: { leaveTypeId: "asc" },
          include: { leaveType: { select: { id: true, name: true, category: true } } },
        },
        _count: { select: { siteLinks: true } },
      },
    });
    return policies;
  }
);

// ─── Create PTO policy ────────────────────────────────────────────────────────

export const createPtoPolicy = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const {
      name, description, isDefault, leaveTypeId, maxDailyHours, allowNegativeBalance, maxNegativeHours, carryOverEnabled, carryOverRespectMaxBalance,
      forecastEnabled, forecastMode, forecastMonths, forecastApplyToAvailable, rules,
      rateMode, serviceMonthBasis, postingAnchorDate,
      posting1Freq, posting1Month, posting1Day,
      dualPosting, posting2Freq, posting2Month, posting2Day,
      posting2ServiceMonthBasis, posting2AnchorDate, posting2StartsOnYear, posting2BasedOnMonths,
      balanceReset, resetMonth, resetDay,
    } = createPtoPolicySchema.parse(input);

    const policy = await db.$transaction(async (tx) => {
      if (isDefault) {
        await tx.ptoPolicy.updateMany({
          where: { tenantId: tenantId!, isDefault: true },
          data: { isDefault: false },
        });
      }

      const p = await tx.ptoPolicy.create({
        data: {
          tenantId: tenantId!,
          name,
          description,
          isDefault,
          leaveTypeId:          leaveTypeId ?? null,
          maxDailyHours:        maxDailyHours ?? null,
          allowNegativeBalance:       allowNegativeBalance ?? false,
          maxNegativeHours:           maxNegativeHours ?? null,
          carryOverEnabled:           carryOverEnabled ?? true,
          carryOverRespectMaxBalance: carryOverRespectMaxBalance ?? false,
          forecastEnabled:            forecastEnabled ?? false,
          forecastMode:               forecastMode ?? null,
          forecastMonths:             forecastMonths ?? null,
          forecastApplyToAvailable:   forecastApplyToAvailable ?? false,
          rateMode,
          serviceMonthBasis,
          postingAnchorDate: postingAnchorDate ?? null,
          posting1Freq,
          posting1Month: posting1Month ?? null,
          posting1Day:   posting1Day   ?? null,
          dualPosting,
          posting2Freq:              posting2Freq              ?? null,
          posting2Month:             posting2Month             ?? null,
          posting2Day:               posting2Day               ?? null,
          posting2ServiceMonthBasis: posting2ServiceMonthBasis ?? null,
          posting2AnchorDate:        posting2AnchorDate        ?? null,
          posting2StartsOnYear:      posting2StartsOnYear      ?? null,
          posting2BasedOnMonths:     posting2BasedOnMonths     ?? false,
          balanceReset,
          resetMonth: resetMonth ?? null,
          resetDay:   resetDay   ?? null,
          rules: {
            create: rules.map((r) => ({
              leaveTypeId:        r.leaveTypeId,
              minTenureMonths:    r.minTenureMonths,
              maxTenureMonths:    r.maxTenureMonths ?? null,
              annualHours:        r.annualHours,
              earnedHoursPerYear: r.earnedHoursPerYear,
              carryOverHours:     r.carryOverHours   ?? null,
              maxAnnualHours:     r.maxAnnualHours   ?? null,
              maxBalanceHours:    r.maxBalanceHours  ?? null,
              payCodeId:          r.payCodeId        ?? null,
            })),
          },
        },
      });

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "PTO_POLICY_CREATED",
        entityType: "PTO_POLICY",
        entityId: p.id,
        changes: { after: { name, isDefault, rules } },
      });

      return p;
    });

    revalidatePath("/admin/pto-policies");
    return policy;
  }
);

// ─── Update PTO policy ────────────────────────────────────────────────────────

export const updatePtoPolicy = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const {
      ptoPolicyId, rules,
      rateMode, serviceMonthBasis, postingAnchorDate,
      posting1Freq, posting1Month, posting1Day,
      dualPosting, posting2Freq, posting2Month, posting2Day,
      posting2ServiceMonthBasis, posting2AnchorDate, posting2StartsOnYear, posting2BasedOnMonths,
      balanceReset, resetMonth, resetDay,
      leaveTypeId, maxDailyHours, allowNegativeBalance, maxNegativeHours, carryOverEnabled, carryOverRespectMaxBalance,
      forecastEnabled, forecastMode, forecastMonths, forecastApplyToAvailable,
      ...fields
    } = updatePtoPolicySchema.parse(input);

    await db.$transaction(async (tx) => {
      if (fields.isDefault) {
        await tx.ptoPolicy.updateMany({
          where: { tenantId: tenantId!, isDefault: true, id: { not: ptoPolicyId } },
          data: { isDefault: false },
        });
      }

      await tx.ptoPolicy.update({
        where: { id: ptoPolicyId },
        data: {
          ...fields,
          ...(rateMode              !== undefined && { rateMode }),
          ...(serviceMonthBasis     !== undefined && { serviceMonthBasis }),
          ...(postingAnchorDate     !== undefined && { postingAnchorDate: postingAnchorDate ?? null }),
          ...(posting1Freq          !== undefined && { posting1Freq }),
          ...(dualPosting           !== undefined && { dualPosting }),
          posting1Month: posting1Month ?? null,
          posting1Day:   posting1Day   ?? null,
          posting2Freq:              posting2Freq              ?? null,
          posting2Month:             posting2Month             ?? null,
          posting2Day:               posting2Day               ?? null,
          posting2ServiceMonthBasis: posting2ServiceMonthBasis ?? null,
          posting2AnchorDate:        posting2AnchorDate        ?? null,
          posting2StartsOnYear:      posting2StartsOnYear      ?? null,
          posting2BasedOnMonths:     posting2BasedOnMonths     ?? false,
          ...(balanceReset !== undefined && { balanceReset }),
          resetMonth:    resetMonth    ?? null,
          resetDay:      resetDay      ?? null,
          ...(maxDailyHours        !== undefined && { maxDailyHours:        maxDailyHours ?? null }),
          ...(leaveTypeId                !== undefined && { leaveTypeId }),
          ...(allowNegativeBalance       !== undefined && { allowNegativeBalance }),
          ...(maxNegativeHours           !== undefined && { maxNegativeHours: maxNegativeHours ?? null }),
          ...(carryOverEnabled           !== undefined && { carryOverEnabled }),
          ...(carryOverRespectMaxBalance !== undefined && { carryOverRespectMaxBalance }),
          ...(forecastEnabled            !== undefined && { forecastEnabled }),
          ...(forecastMode              !== undefined && { forecastMode:   forecastMode ?? null }),
          ...(forecastMonths            !== undefined && { forecastMonths: forecastMonths ?? null }),
          ...(forecastApplyToAvailable  !== undefined && { forecastApplyToAvailable }),
        },
      });

      if (rules !== undefined) {
        await tx.ptoPolicyRule.deleteMany({ where: { ptoPolicyId } });
        if (rules.length > 0) {
          await tx.ptoPolicyRule.createMany({
            data: rules.map((r) => ({
              ptoPolicyId,
              leaveTypeId:        r.leaveTypeId,
              minTenureMonths:    r.minTenureMonths,
              maxTenureMonths:    r.maxTenureMonths ?? null,
              annualHours:        r.annualHours,
              earnedHoursPerYear: r.earnedHoursPerYear,
              carryOverHours:         r.carryOverHours         ?? null,
              carryOverToLeaveTypeId: r.carryOverToLeaveTypeId ?? null,
              maxAnnualHours:         r.maxAnnualHours         ?? null,
              maxBalanceHours:        r.maxBalanceHours        ?? null,
              payCodeId:              r.payCodeId              ?? null,
            })),
          });
        }
      }

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "PTO_POLICY_UPDATED",
        entityType: "PTO_POLICY",
        entityId: ptoPolicyId,
        changes: { after: { ...fields, rules } },
      });
    });

    revalidatePath("/admin/pto-policies");
  }
);

// ─── Delete PTO policy ────────────────────────────────────────────────────────

export const deletePtoPolicy = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { ptoPolicyId } = input as { ptoPolicyId: string };

    const policy = await db.ptoPolicy.findUniqueOrThrow({
      where: { id: ptoPolicyId },
      include: { _count: { select: { siteLinks: true } } },
    });

    if (policy._count.siteLinks > 0) {
      return { success: false as const, error: "This policy is still assigned to sites. Remove those assignments first." };
    }

    await db.$transaction(async (tx) => {
      await tx.ptoPolicy.delete({ where: { id: ptoPolicyId } });

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "PTO_POLICY_DELETED",
        entityType: "PTO_POLICY",
        entityId: ptoPolicyId,
        changes: { before: { name: policy.name } },
      });
    });

    revalidatePath("/admin/pto-policies");
    return { success: true as const };
  }
);

// ─── Get site PTO policies ────────────────────────────────────────────────────

export const getSitePtoPolicies = withRBAC(
  "SITE_MANAGE",
  async (_ctx, input: { siteId: string }) => {
    const { siteId } = input;

    return db.sitePtoPolicy.findMany({
      where: { siteId },
      include: {
        leaveType: { select: { id: true, name: true, category: true } },
        ptoPolicy: { select: { id: true, name: true } },
      },
    });
  }
);

// ─── Assign (or clear) a site PTO policy ─────────────────────────────────────

export const assignSitePtoPolicy = withRBAC(
  "SITE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { siteId, leaveTypeId, ptoPolicyId } = assignSitePtoPolicySchema.parse(input);

    await db.$transaction(async (tx) => {
      if (ptoPolicyId) {
        await tx.sitePtoPolicy.upsert({
          where: { siteId_leaveTypeId: { siteId, leaveTypeId } },
          create: { siteId, leaveTypeId, ptoPolicyId },
          update: { ptoPolicyId },
        });
      } else {
        await tx.sitePtoPolicy.deleteMany({ where: { siteId, leaveTypeId } });
      }

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: ptoPolicyId ? "SITE_PTO_POLICY_ASSIGNED" : "SITE_PTO_POLICY_CLEARED",
        entityType: "PTO_POLICY",
        entityId: siteId,
        changes: { after: { siteId, leaveTypeId, ptoPolicyId } },
      });
    });

    revalidatePath("/admin/sites");
  }
);

