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
    // With no company, tenantId! dropped the filter and listed every company's.
    if (!tenantId) return [];
    const policies = await db.ptoPolicy.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      include: {
        leaveType: { select: { id: true, name: true, category: true } },
        rules: {
          orderBy: { leaveTypeId: "asc" },
          include: { leaveType: { select: { id: true, name: true, category: true } } },
        },
        _count: { select: { siteLinks: true, categoryLinks: true } },
      },
    });
    return policies;
  }
);

// ─── One policy, for its editor page ─────────────────────────────────────────

export const getPtoPolicy = withRBAC(
  "RULES_MANAGE",
  async ({ tenantId }, input: { ptoPolicyId: string }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const policy = await db.ptoPolicy.findFirst({
      where: { id: input.ptoPolicyId, tenantId },
      include: {
        leaveType: { select: { id: true, name: true, category: true } },
        rules: { orderBy: { minTenureMonths: "asc" } },
        _count: { select: { siteLinks: true, categoryLinks: true } },
      },
    });
    if (!policy) throw new Error("NOT_FOUND");
    return policy;
  }
);

/** Every leave type and pay code a policy points at has to be this company's. */
async function assertOwnRefs(
  tenantId: string,
  leaveTypeId: string | null | undefined,
  rules: { leaveTypeId: string; carryOverToLeaveTypeId?: string | null; payCodeId?: string | null }[] | undefined,
) {
  const lt = [...new Set([leaveTypeId, ...(rules ?? []).flatMap((r) => [r.leaveTypeId, r.carryOverToLeaveTypeId])].filter((x): x is string => !!x))];
  const pc = [...new Set((rules ?? []).map((r) => r.payCodeId).filter((x): x is string => !!x))];
  const [ltFound, pcFound] = await Promise.all([
    lt.length ? db.leaveType.count({ where: { id: { in: lt }, tenantId } }) : 0,
    pc.length ? db.payCode.count({ where: { id: { in: pc }, tenantId } }) : 0,
  ]);
  if (ltFound !== lt.length || pcFound !== pc.length) throw new Error("NOT_FOUND");
}

/** A taken name answered with a raw database error; it is said in words. */
function nameTaken(e: unknown): never {
  if ((e as { code?: string })?.code === "P2002") throw new Error("Another leave policy already uses that name.");
  throw e;
}

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
    if (!tenantId) throw new Error("Tenant context required");
    await assertOwnRefs(tenantId, leaveTypeId, rules);

    const policy = await db.$transaction(async (tx) => {
      if (isDefault) {
        await tx.ptoPolicy.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const p = await tx.ptoPolicy.create({
        data: {
          tenantId,
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
              // Left out of create before, so a new policy lost where its
              // unused time carries over to.
              carryOverToLeaveTypeId: r.carryOverToLeaveTypeId ?? null,
              maxAnnualHours:     r.maxAnnualHours   ?? null,
              maxBalanceHours:    r.maxBalanceHours  ?? null,
              payCodeId:          r.payCodeId        ?? null,
            })),
          },
        },
      });

      await writeAuditLog({
        tenantId,
        actorId,
        action: "PTO_POLICY_CREATED",
        entityType: "PTO_POLICY",
        entityId: p.id,
        changes: { after: { name, isDefault, rules } },
      });

      return p;
    }).catch(nameTaken);

    revalidatePath("/admin/rules-setup");
    return { id: policy.id };
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
    if (!tenantId) throw new Error("Tenant context required");
    // Found inside the caller's company first; it used to update by id alone.
    const own = await db.ptoPolicy.findFirst({ where: { id: ptoPolicyId, tenantId }, select: { id: true } });
    if (!own) throw new Error("NOT_FOUND");
    await assertOwnRefs(tenantId, leaveTypeId, rules);

    await db.$transaction(async (tx) => {
      if (fields.isDefault) {
        await tx.ptoPolicy.updateMany({
          where: { tenantId, isDefault: true, id: { not: own.id } },
          data: { isDefault: false },
        });
      }

      await tx.ptoPolicy.update({
        where: { id: own.id },
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
        await tx.ptoPolicyRule.deleteMany({ where: { ptoPolicyId: own.id } });
        if (rules.length > 0) {
          await tx.ptoPolicyRule.createMany({
            data: rules.map((r) => ({
              ptoPolicyId: own.id,
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
        tenantId,
        actorId,
        action: "PTO_POLICY_UPDATED",
        entityType: "PTO_POLICY",
        entityId: ptoPolicyId,
        changes: { after: { ...fields, rules } },
      });
    }).catch(nameTaken);

    revalidatePath("/admin/rules-setup");
  }
);

// ─── Delete PTO policy ────────────────────────────────────────────────────────

export const deletePtoPolicy = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { ptoPolicyId } = input as { ptoPolicyId: string };
    if (!tenantId) throw new Error("Tenant context required");

    // Found inside the caller's company; it used to delete by id alone.
    const policy = await db.ptoPolicy.findFirst({
      where: { id: ptoPolicyId, tenantId },
      include: { _count: { select: { siteLinks: true, categoryLinks: true } } },
    });
    if (!policy) throw new Error("NOT_FOUND");

    // The refusal used to come back as a successful result, so the screen
    // closed as if it had worked. And a policy on pay categories was
    // deleted with them, quietly changing what their people accrue.
    const { siteLinks, categoryLinks } = policy._count;
    if (siteLinks > 0 || categoryLinks > 0) {
      const on = [
        siteLinks ? `${siteLinks} ${siteLinks === 1 ? "site" : "sites"}` : "",
        categoryLinks ? `${categoryLinks} pay ${categoryLinks === 1 ? "category" : "categories"}` : "",
      ].filter(Boolean).join(" and ");
      throw new Error(`This policy is on ${on}. Take it off those first, or set it to inactive.`);
    }

    await db.$transaction(async (tx) => {
      await tx.ptoPolicy.deleteMany({ where: { id: policy.id, tenantId } });

      await writeAuditLog({
        tenantId,
        actorId,
        action: "PTO_POLICY_DELETED",
        entityType: "PTO_POLICY",
        entityId: ptoPolicyId,
        changes: { before: { name: policy.name } },
      });
    });

    revalidatePath("/admin/rules-setup");
    return { success: true as const };
  }
);

// ─── Get site PTO policies ────────────────────────────────────────────────────

export const getSitePtoPolicies = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId }, input: { siteId: string }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { siteId } = input;

    return db.sitePtoPolicy.findMany({
      where: { siteId, site: { tenantId } },
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
    if (!tenantId) throw new Error("Tenant context required");
    const { siteId, leaveTypeId, ptoPolicyId } = assignSitePtoPolicySchema.parse(input);

    // The site, the leave type and the policy all have to be this company's.
    const [site, leaveType, policy] = await Promise.all([
      db.site.findFirst({ where: { id: siteId, tenantId }, select: { id: true } }),
      db.leaveType.findFirst({ where: { id: leaveTypeId, tenantId }, select: { id: true } }),
      ptoPolicyId
        ? db.ptoPolicy.findFirst({ where: { id: ptoPolicyId, tenantId, isActive: true }, select: { id: true } })
        : Promise.resolve({ id: null }),
    ]);
    if (!site || !leaveType || !policy) throw new Error("NOT_FOUND");

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

// ─── One site's leave policy page ────────────────────────────────────────────

/**
 * Everything the site page draws, inside this company: the site, its active
 * leave types, the active policies that can be picked and the ones already
 * picked. Gated like the assignments themselves, on SITE_MANAGE, so somebody
 * who may assign a policy can also see the names on offer. It used to read
 * those through getPtoPolicies, which needs RULES_MANAGE, and showed such a
 * person an empty list with no word why. Only the names come back.
 */
export const getSitePolicySetup = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId }, input: { siteId: string }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const site = await db.site.findFirst({ where: { id: input.siteId, tenantId } });
    if (!site) throw new Error("NOT_FOUND");
    const [leaveTypes, policies, assignments] = await Promise.all([
      db.leaveType.findMany({
        where: { tenantId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, category: true },
      }),
      db.ptoPolicy.findMany({
        where: { tenantId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      db.sitePtoPolicy.findMany({
        where: { siteId: site.id },
        select: { leaveTypeId: true, ptoPolicyId: true },
      }),
    ]);
    return { site, leaveTypes, policies, assignments };
  }
);
