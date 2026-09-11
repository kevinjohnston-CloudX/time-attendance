"use server";

import { parseISO, addMonths, addYears, differenceInMonths } from "date-fns";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { encryptPiiFields, decryptPiiFields } from "@/lib/crypto/pii";

// Maps system custom role names to their legacy enum values
const SYSTEM_ROLE_NAME_TO_ENUM: Record<string, string> = {
  "Employee": "EMPLOYEE",
  "Supervisor": "SUPERVISOR",
  "Payroll Admin": "PAYROLL_ADMIN",
  "HR Admin": "HR_ADMIN",
  "System Admin": "SYSTEM_ADMIN",
};

import {
  createEmployeeSchema,
  updateEmployeeSchema,
  siteSchema,
  updateSiteSchema,
  departmentSchema,
  updateDepartmentSchema,
  leaveTypeSchema,
  updateLeaveTypeSchema,
  ruleSetSchema,
  updateRuleSetSchema,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
  type SiteInput,
  type UpdateSiteInput,
  type DepartmentInput,
  type UpdateDepartmentInput,
  type LeaveTypeInput,
  type UpdateLeaveTypeInput,
  type RuleSetInput,
  type UpdateRuleSetInput,
  adjustLeaveBalanceSchema,
  csvEmployeeRowSchema,
  postAccrualCorrectionSchema,
  ROLES,
  type AdjustLeaveBalanceInput,
  type CsvEmployeeRow,
} from "@/lib/validators/admin.schema";

const BUILT_IN_ROLES = new Set<string>(ROLES.map((r) => r.toUpperCase()));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serializePayRate<T extends { payRate: unknown }>(emp: T): Omit<T, "payRate"> & { payRate: number | null } {
  const { payRate, ...rest } = emp;
  return { ...rest, payRate: payRate != null ? Number(payRate) : null };
}

// ─── Reference data (used by forms) ──────────────────────────────────────────

export const getAdminRefData = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ tenantId }, _input: void) => {
    const t = tenantId ?? undefined;
    const [sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes] = await Promise.all([
      db.site.findMany({ where: { isActive: true, tenantId: t }, orderBy: { name: "asc" } }),
      db.department.findMany({
        where: { isActive: true, tenantId: t },
        orderBy: { name: "asc" },
        include: { sites: { include: { site: true } } },
      }),
      db.ruleSet.findMany({ where: { tenantId: t }, orderBy: { name: "asc" } }),
      db.employee.findMany({
        where: { isActive: true, tenantId: t },
        include: { user: true },
        orderBy: { user: { name: "asc" } },
      }),
      db.customRole.findMany({
        where: { tenantId: t, isActive: true },
        select: { id: true, name: true, isSystem: true, rank: true },
        orderBy: { rank: "asc" },
      }),
      db.shift.findMany({
        where: { isActive: true, tenantId: t },
        orderBy: [{ startTime: "asc" }, { name: "asc" }],
        select: { id: true, name: true, startTime: true, endTime: true },
      }),
      db.holidayRule.findMany({
        where: { isActive: true, tenantId: t },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      db.payCategory.findMany({
        where: { isActive: true, tenantId: t },
        orderBy: { number: "asc" },
        select: { id: true, number: true, description: true },
      }),
      db.payType.findMany({
        where: { isActive: true, includeInEmployeeSetup: true, tenantId: t },
        orderBy: { number: "asc" },
        select: { id: true, number: true, description: true },
      }),
    ]);
    return { sites, departments, ruleSets, employees: employees.map(serializePayRate), customRoles, shifts, holidayRules, payCategories, payTypes };
  }
);

// ─── Employees ────────────────────────────────────────────────────────────────

export const getEmployees = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ tenantId }, _input: void) => {
    const employees = await db.employee.findMany({
      where: { tenantId: tenantId ?? undefined },
      include: {
        user: true,
        site: true,
        department: true,
        ruleSet: true,
        supervisor: { include: { user: true } },
        customRole: { select: { id: true, name: true } },
      },
      orderBy: { user: { name: "asc" } },
    });
    return employees.map((e) => {
      const emp = serializePayRate(e);
      return { ...emp, supervisor: emp.supervisor ? serializePayRate(emp.supervisor) : null };
    });
  }
);

export const getEmployeeById = withRBAC(
  "EMPLOYEE_MANAGE",
  async (_actor, input: { employeeId: string }) => {
    const emp = await db.employee.findUniqueOrThrow({
      where: { id: input.employeeId },
      include: {
        user: true,
        site: true,
        department: true,
        ruleSet: true,
        supervisor: { include: { user: true } },
      },
    });
    const serialized = serializePayRate(decryptPiiFields(emp));
    return { ...serialized, supervisor: serialized.supervisor ? serializePayRate(serialized.supervisor) : null };
  }
);

export const createEmployee = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: CreateEmployeeInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = createEmployeeSchema.parse(input);

    // Auto-assign the system custom role when only a role enum is provided
    let resolvedCustomRoleId = parsed.customRoleId ?? null;
    let resolvedRole = parsed.role;
    if (!resolvedCustomRoleId) {
      const systemName = Object.entries(SYSTEM_ROLE_NAME_TO_ENUM).find(([, v]) => v === parsed.role)?.[0];
      if (systemName) {
        const systemRole = await db.customRole.findFirst({
          where: { tenantId, isSystem: true, name: systemName, isActive: true },
          select: { id: true },
        });
        resolvedCustomRoleId = systemRole?.id ?? null;
      }
    } else {
      // Derive role enum from the provided customRoleId
      const cr = await db.customRole.findUnique({ where: { id: resolvedCustomRoleId }, select: { isSystem: true, name: true } });
      resolvedRole = (cr?.isSystem ? (SYSTEM_ROLE_NAME_TO_ENUM[cr.name] ?? "EMPLOYEE") : "EMPLOYEE") as typeof parsed.role;
    }

    const employee = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: parsed.name,
          email: parsed.email,
        },
      });

      const encPii = encryptPiiFields({
        phone: parsed.phone, phone2: parsed.phone2, gender: parsed.gender, maritalStatus: parsed.maritalStatus,
        emergencyContact: parsed.emergencyContact, emergencyPhone: parsed.emergencyPhone, emergencyRelationship: parsed.emergencyRelationship,
        address1: parsed.address1, address2: parsed.address2, city: parsed.city, state: parsed.state, country: parsed.country, zipCode: parsed.zipCode,
      });

      return tx.employee.create({
        data: {
          userId: user.id,
          tenantId,
          employeeCode: parsed.employeeCode,
          role: resolvedRole,
          customRoleId: resolvedCustomRoleId,
          siteId: parsed.siteId,
          departmentId: parsed.departmentId,
          ruleSetId: parsed.ruleSetId,
          hireDate: parseISO(parsed.hireDate),
          supervisorId: parsed.supervisorId ?? null,
          wmsId: parsed.wmsId ?? null,
          payType: parsed.payType ?? null,
          payRate: parsed.payRate ?? null,
          jobTitle: parsed.jobTitle ?? null,
          adpWorkerId: parsed.adpWorkerId ?? null,
          shiftId: parsed.shiftId ?? null,
          holidayRuleId: parsed.holidayRuleId ?? null,
          payCategoryId: parsed.payCategoryId ?? null,
          payTypeId: parsed.payTypeId ?? null,
          ...encPii,
        },
      });
    });

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: employee.id,
      action: "EMPLOYEE_CREATED",
      changes: { after: { employeeCode: parsed.employeeCode, role: parsed.role } },
    });

    revalidatePath("/admin/employees");
    return employee;
  }
);

export const updateEmployee = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: UpdateEmployeeInput) => {
    const {
      employeeId, name, email, role, customRoleId, supervisorId, siteId, departmentId, ruleSetId, shiftId, holidayRuleId, payCategoryId, payTypeId, isActive, onLeave, wmsId, adpWorkerId,
      jobTitle, terminationReason, payType, payRate,
      phone, phone2, gender, maritalStatus,
      emergencyContact, emergencyPhone, emergencyRelationship,
      address1, address2, city, state, country, zipCode,
    } = updateEmployeeSchema.parse(input);

    const current = await db.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { user: true },
    });

    // Derive the role enum from the custom role when customRoleId is being set
    let derivedRole: string | undefined = role;
    if (customRoleId !== undefined && customRoleId !== null) {
      const cr = await db.customRole.findUnique({
        where: { id: customRoleId },
        select: { isSystem: true, name: true },
      });
      derivedRole = cr?.isSystem ? (SYSTEM_ROLE_NAME_TO_ENUM[cr.name] ?? "EMPLOYEE") : "EMPLOYEE";
    }

    await db.$transaction(async (tx) => {
      if (name !== undefined || email !== undefined) {
        await tx.user.update({
          where: { id: current.userId },
          data: { ...(name !== undefined && { name }), ...(email !== undefined && { email }) },
        });
      }
      const encPii = encryptPiiFields({
        phone, phone2, gender, maritalStatus,
        emergencyContact, emergencyPhone, emergencyRelationship,
        address1, address2, city, state, country, zipCode,
      });
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          ...(derivedRole !== undefined && { role: derivedRole as import("@prisma/client").Role }),
          ...(customRoleId !== undefined && { customRole: customRoleId ? { connect: { id: customRoleId } } : { disconnect: true } }),
          ...(supervisorId !== undefined && { supervisor: supervisorId ? { connect: { id: supervisorId } } : { disconnect: true } }),
          ...(siteId !== undefined && { site: { connect: { id: siteId } } }),
          ...(departmentId !== undefined && { department: { connect: { id: departmentId } } }),
          ...(ruleSetId !== undefined && { ruleSet: { connect: { id: ruleSetId } } }),
          ...(shiftId !== undefined && { shift: shiftId ? { connect: { id: shiftId } } : { disconnect: true } }),
          ...(holidayRuleId !== undefined && { holidayRule: holidayRuleId ? { connect: { id: holidayRuleId } } : { disconnect: true } }),
          ...(payCategoryId !== undefined && { payCategory: payCategoryId ? { connect: { id: payCategoryId } } : { disconnect: true } }),
          ...(payTypeId !== undefined && { payTypeLookup: payTypeId ? { connect: { id: payTypeId } } : { disconnect: true } }),
          ...(isActive !== undefined && { isActive }),
          ...(onLeave !== undefined && { onLeave }),
          ...(wmsId !== undefined && { wmsId }),
          ...(adpWorkerId !== undefined && { adpWorkerId }),
          ...(jobTitle !== undefined && { jobTitle }),
          ...(terminationReason !== undefined && { terminationReason }),
          ...(payType !== undefined && { payType }),
          ...(payRate !== undefined && { payRate }),
          ...(encPii.phone !== undefined && { phone: encPii.phone }),
          ...(encPii.phone2 !== undefined && { phone2: encPii.phone2 }),
          ...(encPii.gender !== undefined && { gender: encPii.gender }),
          ...(encPii.maritalStatus !== undefined && { maritalStatus: encPii.maritalStatus }),
          ...(encPii.emergencyContact !== undefined && { emergencyContact: encPii.emergencyContact }),
          ...(encPii.emergencyPhone !== undefined && { emergencyPhone: encPii.emergencyPhone }),
          ...(encPii.emergencyRelationship !== undefined && { emergencyRelationship: encPii.emergencyRelationship }),
          ...(encPii.address1 !== undefined && { address1: encPii.address1 }),
          ...(encPii.address2 !== undefined && { address2: encPii.address2 }),
          ...(encPii.city !== undefined && { city: encPii.city }),
          ...(encPii.state !== undefined && { state: encPii.state }),
          ...(encPii.country !== undefined && { country: encPii.country }),
          ...(encPii.zipCode !== undefined && { zipCode: encPii.zipCode }),
        },
      });
    });

    // TODO: migrate open timesheets to the new rule set's pay period when ruleSetId changes
    // (src/lib/timesheet-migration.ts — not yet implemented)

    // Build field-level diff for audit log
    const decCurrent = decryptPiiFields({
      phone: current.phone, phone2: current.phone2, gender: current.gender,
      maritalStatus: current.maritalStatus, emergencyContact: current.emergencyContact,
      emergencyPhone: current.emergencyPhone, emergencyRelationship: current.emergencyRelationship,
      address1: current.address1, address2: current.address2, city: current.city,
      state: current.state, country: current.country, zipCode: current.zipCode,
    });

    const fieldChanges: Array<{ field: string; before: string; after: string }> = [];
    function diff(label: string, before: string | null | undefined, after: string | null | undefined) {
      const b = (before?.trim() || null) ?? "—";
      const a = (after?.trim() || null) ?? "—";
      if (b !== a) fieldChanges.push({ field: label, before: b, after: a });
    }

    if (name !== undefined) diff("Full Name", current.user.name, name);
    if (email !== undefined) diff("Email", current.user.email, email);
    if (derivedRole !== undefined) diff("Role", current.role, derivedRole);
    const statusLabel = (active: boolean, leave: boolean) => !active ? "Inactive" : leave ? "On Leave" : "Active";
    if (isActive !== undefined || onLeave !== undefined) {
      const newActive = isActive ?? current.isActive;
      const newLeave = onLeave ?? current.onLeave;
      diff("Status", statusLabel(current.isActive, current.onLeave), statusLabel(newActive, newLeave));
    }
    if (jobTitle !== undefined) diff("Job Title", current.jobTitle, jobTitle);
    if (wmsId !== undefined) diff("Badge ID (WMS)", current.wmsId, wmsId);
    if (adpWorkerId !== undefined) diff("ADP Worker ID", current.adpWorkerId, adpWorkerId);
    if (terminationReason !== undefined) diff("Termination Reason", current.terminationReason, terminationReason);
    if (payType !== undefined) diff("Pay Type", current.payType, payType);
    if (payRate !== undefined) {
      const cur = current.payRate != null ? parseFloat(String(current.payRate)) : null;
      if (cur !== payRate) diff("Pay Rate", cur != null ? `$${cur.toFixed(2)}` : null, payRate != null ? `$${payRate.toFixed(2)}` : null);
    }
    if (phone !== undefined) diff("Phone 1", decCurrent.phone, phone);
    if (phone2 !== undefined) diff("Phone 2", decCurrent.phone2, phone2);
    if (gender !== undefined) diff("Gender", decCurrent.gender, gender);
    if (maritalStatus !== undefined) diff("Marital Status", decCurrent.maritalStatus, maritalStatus);
    if (emergencyContact !== undefined) diff("Emergency Contact", decCurrent.emergencyContact, emergencyContact);
    if (emergencyPhone !== undefined) diff("Emergency Phone", decCurrent.emergencyPhone, emergencyPhone);
    if (emergencyRelationship !== undefined) diff("Emergency Relationship", decCurrent.emergencyRelationship, emergencyRelationship);
    if (address1 !== undefined) diff("Address Line 1", decCurrent.address1, address1);
    if (address2 !== undefined) diff("Address Line 2", decCurrent.address2, address2);
    if (city !== undefined) diff("City", decCurrent.city, city);
    if (state !== undefined) diff("State", decCurrent.state, state);
    if (country !== undefined) diff("Country", decCurrent.country, country);
    if (zipCode !== undefined) diff("Zip Code", decCurrent.zipCode, zipCode);

    // Relation fields — resolve names only when the ID actually changed
    if (siteId !== undefined && siteId !== current.siteId) {
      const [from, to] = await Promise.all([
        db.site.findUnique({ where: { id: current.siteId }, select: { name: true } }),
        db.site.findUnique({ where: { id: siteId }, select: { name: true } }),
      ]);
      diff("Site", from?.name, to?.name);
    }
    if (departmentId !== undefined && departmentId !== current.departmentId) {
      const [from, to] = await Promise.all([
        db.department.findUnique({ where: { id: current.departmentId }, select: { name: true } }),
        db.department.findUnique({ where: { id: departmentId }, select: { name: true } }),
      ]);
      diff("Department", from?.name, to?.name);
    }
    if (ruleSetId !== undefined && ruleSetId !== current.ruleSetId) {
      const [from, to] = await Promise.all([
        db.ruleSet.findUnique({ where: { id: current.ruleSetId }, select: { name: true } }),
        db.ruleSet.findUnique({ where: { id: ruleSetId }, select: { name: true } }),
      ]);
      diff("Rule Set", from?.name, to?.name);
    }
    if (shiftId !== undefined && shiftId !== current.shiftId) {
      const [from, to] = await Promise.all([
        current.shiftId ? db.shift.findUnique({ where: { id: current.shiftId }, select: { name: true } }) : Promise.resolve(null),
        shiftId ? db.shift.findUnique({ where: { id: shiftId }, select: { name: true } }) : Promise.resolve(null),
      ]);
      diff("Shift", from?.name, to?.name);
    }
    if (holidayRuleId !== undefined && holidayRuleId !== current.holidayRuleId) {
      const [from, to] = await Promise.all([
        current.holidayRuleId ? db.holidayRule.findUnique({ where: { id: current.holidayRuleId }, select: { name: true } }) : Promise.resolve(null),
        holidayRuleId ? db.holidayRule.findUnique({ where: { id: holidayRuleId }, select: { name: true } }) : Promise.resolve(null),
      ]);
      diff("Holiday Rule", from?.name, to?.name);
    }
    if (payCategoryId !== undefined && payCategoryId !== current.payCategoryId) {
      const fmtCat = (c: { number: number; description: string | null } | null) =>
        c ? `${c.number}${c.description ? ` — ${c.description}` : ""}` : null;
      const [from, to] = await Promise.all([
        current.payCategoryId ? db.payCategory.findUnique({ where: { id: current.payCategoryId }, select: { number: true, description: true } }) : Promise.resolve(null),
        payCategoryId ? db.payCategory.findUnique({ where: { id: payCategoryId }, select: { number: true, description: true } }) : Promise.resolve(null),
      ]);
      diff("Pay Category", fmtCat(from), fmtCat(to));

      // Write POLICY_CHANGE ledger entries for each leave type covered by the new category's policies
      if (payCategoryId) {
        const newCat = await db.payCategory.findUnique({
          where: { id: payCategoryId },
          include: {
            ptoPolicies: {
              include: {
                ptoPolicy: {
                  select: {
                    name: true,
                    rules: {
                      select: {
                        leaveTypeId: true,
                        minTenureMonths: true,
                        maxTenureMonths: true,
                        annualHours: true,
                        earnedHoursPerYear: true,
                      },
                      orderBy: { minTenureMonths: "asc" },
                    },
                  },
                },
              },
            },
          },
        });

        if (newCat) {
          const accrualYear = new Date().getFullYear();
          const tenureMonths = differenceInMonths(new Date(), current.hireDate);
          const tenureYears = Math.floor(tenureMonths / 12);
          const seenLeaveTypeIds = new Set<string>();

          for (const policyLink of newCat.ptoPolicies) {
            const policy = policyLink.ptoPolicy;
            const leaveTypeIds = [...new Set(policy.rules.map((r) => r.leaveTypeId))];

            for (const leaveTypeId of leaveTypeIds) {
              if (seenLeaveTypeIds.has(leaveTypeId)) continue;
              seenLeaveTypeIds.add(leaveTypeId);

              const tiersForLt = policy.rules.filter((r) => r.leaveTypeId === leaveTypeId);
              const matchingTier = tiersForLt.find(
                (t) => t.minTenureMonths <= tenureMonths && (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths)
              ) ?? tiersForLt[0];

              const effectiveAnnualHours = matchingTier
                ? matchingTier.annualHours + tenureYears * matchingTier.earnedHoursPerYear
                : 0;

              const currentBalance = await db.leaveBalance.findUnique({
                where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear } },
                select: { balanceMinutes: true },
              });

              await db.leaveAccrualLedger.create({
                data: {
                  employeeId,
                  leaveTypeId,
                  action: "POLICY_CHANGE",
                  deltaMinutes: Math.round(effectiveAnnualHours * 60),
                  balanceAfter: currentBalance?.balanceMinutes ?? 0,
                  note: `Policy changed to ${policy.name}`,
                  createdById: actorId,
                },
              });
            }
          }
        }
      }
    }
    if (supervisorId !== undefined && supervisorId !== current.supervisorId) {
      const [from, to] = await Promise.all([
        current.supervisorId ? db.employee.findUnique({ where: { id: current.supervisorId }, include: { user: { select: { name: true } } } }) : Promise.resolve(null),
        supervisorId ? db.employee.findUnique({ where: { id: supervisorId }, include: { user: { select: { name: true } } } }) : Promise.resolve(null),
      ]);
      diff("Supervisor", from?.user.name, to?.user.name);
    }

    if (fieldChanges.length > 0) {
      await writeAuditLog({
        tenantId,
        actorId,
        entityType: "EMPLOYEE",
        entityId: employeeId,
        action: "EMPLOYEE_UPDATED",
        changes: { fields: fieldChanges },
      });
    }

    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${employeeId}`);
    return { employeeId };
  }
);

export const getEmployeeAuditLogs = withRBAC(
  "EMPLOYEE_MANAGE",
  async (_actor, { employeeId }: { employeeId: string }) => {
    const logs = await db.auditLog.findMany({
      where: { entityType: "EMPLOYEE", entityId: employeeId, action: "EMPLOYEE_UPDATED" },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        actor: { select: { user: { select: { name: true } } } },
      },
    });
    return logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      actorName: log.actor?.user.name ?? "System",
      fields: (log.changes as { fields?: Array<{ field: string; before: string; after: string }> } | null)?.fields ?? [],
    }));
  }
);

export const getEmployeeLeaveLog = withRBAC(
  "EMPLOYEE_MANAGE",
  async (_actor, { employeeId }: { employeeId: string }) => {
    const [employee, ledgerEntries] = await Promise.all([
      db.employee.findUnique({
        where: { id: employeeId },
        select: { user: { select: { name: true } } },
      }),
      db.leaveAccrualLedger.findMany({
        where: { employeeId, action: { in: ["ACCRUAL", "EARNED_ADJUSTMENT", "USAGE", "ADJUSTMENT", "TIMECARD_DEDUCTION", "EOD_SNAPSHOT", "POLICY_CHANGE"] } },
        orderBy: { createdAt: "desc" },
        take: 500,
        include: {
          leaveType: { select: { name: true } },
          leaveRequest: { select: { note: true, startDate: true, endDate: true, sourcePunchId: true } },
        },
      }),
    ]);

    if (!employee) return [];

    // Batch-fetch creator names for ADJUSTMENT entries
    const creatorIds = [
      ...new Set(
        ledgerEntries
          .filter((e) => (e.action === "ADJUSTMENT" || e.action === "EARNED_ADJUSTMENT" || e.action === "POLICY_CHANGE" || e.action === "TIMECARD_DEDUCTION") && e.createdById)
          .map((e) => e.createdById as string)
      ),
    ];
    const creatorById = new Map<string, string>();
    if (creatorIds.length > 0) {
      const creators = await db.employee.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, user: { select: { name: true } } },
      });
      for (const c of creators) creatorById.set(c.id, c.user.name ?? "Unknown");
    }

    return ledgerEntries.map((entry) => {
      const isAccrualReset = entry.note === "[Accrual Reset]";

      const isTimecardAdjustment = entry.action === "ADJUSTMENT" &&
        (!!entry.leaveRequest?.sourcePunchId || entry.note === "Timecard entry");

      const eventType =
        entry.action === "EOD_SNAPSHOT"        ? "eod_balance" :
        entry.action === "POLICY_CHANGE"       ? "policy_change" :
        isAccrualReset                          ? "accrual_reset" :
        entry.action === "ACCRUAL"             ? "accrual" :
        entry.action === "EARNED_ADJUSTMENT"   ? "accrual" :
        entry.action === "TIMECARD_DEDUCTION"  ? "timecard_entry" :
        isTimecardAdjustment                   ? "timecard_entry" :
        entry.action === "USAGE"               ? "leave_request" :
        "balance_adjustment";

      const userName =
        entry.action === "EOD_SNAPSHOT"        ? "System" :
        entry.action === "POLICY_CHANGE"       ? (entry.createdById ? (creatorById.get(entry.createdById) ?? "Unknown") : "System") :
        isAccrualReset                          ? (entry.createdById ? (creatorById.get(entry.createdById) ?? "System") : "System") :
        entry.action === "ACCRUAL"             ? "System" :
        entry.action === "EARNED_ADJUSTMENT"   ? (entry.createdById ? (creatorById.get(entry.createdById) ?? "Unknown") : "System") :
        entry.action === "TIMECARD_DEDUCTION"  ? (entry.createdById ? (creatorById.get(entry.createdById) ?? "Unknown") : "System") :
        isTimecardAdjustment                   ? (entry.createdById ? (creatorById.get(entry.createdById) ?? "Unknown") : "System") :
        entry.action === "USAGE"               ? (employee.user.name ?? "Employee") :
        entry.createdById                      ? (creatorById.get(entry.createdById) ?? "Unknown") :
        "System";

      const note =
        entry.action === "EOD_SNAPSHOT"        ? "Daily Balance Logging" :
        entry.action === "POLICY_CHANGE"       ? (entry.note ?? null) :
        isAccrualReset                          ? null :
        entry.action === "USAGE"               ? (entry.leaveRequest?.note ?? null) :
        entry.action === "TIMECARD_DEDUCTION"  ? (entry.note ?? null) :
        entry.action === "ADJUSTMENT"          ? (entry.note ?? null) :
        entry.action === "EARNED_ADJUSTMENT"   ? (entry.note ?? null) :
        null;

      return {
        id: entry.id,
        timestamp: entry.createdAt.toISOString(),
        eventType: eventType as "accrual" | "accrual_reset" | "leave_request" | "balance_adjustment" | "eod_balance" | "policy_change" | "timecard_entry",
        leaveTypeName: entry.leaveType.name,
        deltaMinutes: entry.deltaMinutes,
        balanceAfterMinutes: entry.balanceAfter,
        note,
        userName,
      };
    });
  }
);

// ─── Sites ────────────────────────────────────────────────────────────────────

export const getSites = withRBAC("SITE_MANAGE", async ({ tenantId }, _input: void) => {
  return db.site.findMany({ where: { tenantId: tenantId ?? undefined }, orderBy: { name: "asc" } });
});

export const createSite = withRBAC(
  "SITE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: SiteInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = siteSchema.parse(input);
    const site = await db.site.create({ data: { ...parsed, tenantId } });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: site.id,
      action: "SITE_CREATED",
      changes: { after: { name: site.name } },
    });
    revalidatePath("/admin/sites");
    return site;
  }
);

export const updateSite = withRBAC(
  "SITE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: UpdateSiteInput) => {
    const { siteId, isActive, ...rest } = updateSiteSchema.parse(input);
    const updated = await db.site.update({
      where: { id: siteId },
      data: { ...rest, ...(isActive !== undefined && { isActive }) },
    });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: siteId,
      action: "SITE_UPDATED",
    });
    revalidatePath("/admin/sites");
    return updated;
  }
);

// ─── Departments ──────────────────────────────────────────────────────────────

export const getDepartments = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId }, _input: void) => {
    return db.department.findMany({
      where: { tenantId: tenantId ?? undefined },
      include: { sites: { include: { site: true } } },
      orderBy: { name: "asc" },
    });
  }
);

export const createDepartment = withRBAC(
  "SITE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: DepartmentInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { name, siteIds } = departmentSchema.parse(input);
    const dept = await db.department.create({
      data: {
        name,
        tenantId,
        sites: { create: siteIds.map((siteId) => ({ siteId })) },
      },
    });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: dept.id,
      action: "DEPARTMENT_CREATED",
      changes: { after: { name: dept.name } },
    });
    revalidatePath("/admin/departments");
    return dept;
  }
);

export const updateDepartment = withRBAC(
  "SITE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: UpdateDepartmentInput) => {
    const { departmentId, isActive, siteIds, name } = updateDepartmentSchema.parse(input);
    await db.$transaction(async (tx) => {
      await tx.department.update({
        where: { id: departmentId },
        data: { name, ...(isActive !== undefined && { isActive }) },
      });
      await tx.departmentSite.deleteMany({ where: { departmentId } });
      await tx.departmentSite.createMany({
        data: siteIds.map((siteId) => ({ departmentId, siteId })),
      });
    });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: departmentId,
      action: "DEPARTMENT_UPDATED",
    });
    revalidatePath("/admin/departments");
    return { success: true };
  }
);

// ─── Leave Types ──────────────────────────────────────────────────────────────

export const getLeaveTypesAdmin = withRBAC(
  "RULES_MANAGE",
  async ({ tenantId }, _input: void) => {
    return db.leaveType.findMany({ where: { tenantId: tenantId ?? undefined }, orderBy: { name: "asc" } });
  }
);

export const createLeaveType = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: LeaveTypeInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = leaveTypeSchema.parse(input);
    let { externalCode } = parsed;
    if (externalCode == null) {
      const max = await db.leaveType.findFirst({
        where: { tenantId, externalCode: { gte: 1 } },
        orderBy: { externalCode: "desc" },
        select: { externalCode: true },
      });
      externalCode = (max?.externalCode ?? 0) + 1;
    }
    const lt = await db.leaveType.create({ data: { ...parsed, externalCode, tenantId } });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "RULE_SET",
      entityId: lt.id,
      action: "LEAVE_TYPE_CREATED",
      changes: { after: { name: lt.name } },
    });
    revalidatePath("/admin/site-settings");
    return lt;
  }
);

export const updateLeaveType = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: UpdateLeaveTypeInput) => {
    const { leaveTypeId, isActive, ...rest } = updateLeaveTypeSchema.parse(input);
    const updated = await db.leaveType.update({
      where: { id: leaveTypeId },
      data: { ...rest, ...(isActive !== undefined && { isActive }) },
    });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "RULE_SET",
      entityId: leaveTypeId,
      action: "LEAVE_TYPE_UPDATED",
    });
    revalidatePath("/admin/site-settings");
    return updated;
  }
);

// ─── Rule Sets ────────────────────────────────────────────────────────────────

export const getRuleSets = withRBAC(
  "RULES_MANAGE",
  async ({ tenantId }, _input: void) => {
    return db.ruleSet.findMany({ where: { tenantId: tenantId ?? undefined }, orderBy: { name: "asc" } });
  }
);

export const createRuleSet = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: RuleSetInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { payPeriodAnchorDate: anchorStr, otCycleAnchorDate: otAnchorStr, ...parsed } = ruleSetSchema.parse(input);
    const payPeriodAnchorDate = anchorStr ? new Date(anchorStr + "T12:00:00") : null;
    const otCycleAnchorDate = otAnchorStr ? new Date(otAnchorStr + "T12:00:00") : null;
    const rs = await db.ruleSet.create({ data: { ...parsed, payPeriodAnchorDate, otCycleAnchorDate, tenantId } });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "RULE_SET",
      entityId: rs.id,
      action: "RULE_SET_CREATED",
      changes: { after: { name: rs.name } },
    });
    revalidatePath("/admin/rules");
    return rs;
  }
);

export const updateRuleSet = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: UpdateRuleSetInput) => {
    const { ruleSetId, payPeriodAnchorDate: anchorStr, otCycleAnchorDate: otAnchorStr, ...rest } = updateRuleSetSchema.parse(input);
    const payPeriodAnchorDate = anchorStr ? new Date(anchorStr + "T12:00:00") : null;
    const otCycleAnchorDate = otAnchorStr ? new Date(otAnchorStr + "T12:00:00") : null;
    const updated = await db.ruleSet.update({ where: { id: ruleSetId }, data: { ...rest, payPeriodAnchorDate, otCycleAnchorDate } });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "RULE_SET",
      entityId: ruleSetId,
      action: "RULE_SET_UPDATED",
    });
    revalidatePath("/admin/rules");
    return updated;
  }
);

export const deleteRuleSet = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: { ruleSetId: string }) => {
    const rs = await db.ruleSet.findUniqueOrThrow({
      where: { id: input.ruleSetId },
      include: { _count: { select: { employees: true } } },
    });
    if (rs.isDefault) throw new Error("Cannot delete the default rule set.");
    if (rs._count.employees > 0)
      throw new Error(
        `Cannot delete — ${rs._count.employees} employee(s) are assigned to this rule set. Reassign them first.`
      );
    await db.ruleSet.delete({ where: { id: input.ruleSetId } });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "RULE_SET",
      entityId: input.ruleSetId,
      action: "RULE_SET_DELETED",
      changes: { before: { name: rs.name } },
    });
    revalidatePath("/admin/rules");
  }
);

// ─── Employee Leave Balances ───────────────────────────────────────────────────

/** All active leave types merged with this employee's balances for a given year. */
export const getEmployeeLeaveBalances = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ tenantId }, input: { employeeId: string; year?: number }) => {
    const year = input.year ?? new Date().getFullYear();
    const [leaveTypes, balances] = await Promise.all([
      db.leaveType.findMany({ where: { isActive: true, tenantId: tenantId ?? undefined }, orderBy: { name: "asc" } }),
      db.leaveBalance.findMany({ where: { employeeId: input.employeeId, accrualYear: year } }),
    ]);
    return leaveTypes.map((lt) => {
      const bal = balances.find((b) => b.leaveTypeId === lt.id);
      return {
        leaveTypeId: lt.id,
        leaveTypeName: lt.name,
        category: lt.category as string,
        balanceMinutes: bal?.balanceMinutes ?? 0,
        usedMinutes: bal?.usedMinutes ?? 0,
          year,
      };
    });
  }
);

/** Admin sets a leave balance directly; writes an immutable ADJUSTMENT ledger entry. */
export const adjustLeaveBalance = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: AdjustLeaveBalanceInput) => {
    const { employeeId, leaveTypeId, year, mode, enteredMinutes, newBalanceMinutes, note } =
      adjustLeaveBalanceSchema.parse(input);

    const existing = await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      update: {},
      create: { employeeId, leaveTypeId, accrualYear: year, balanceMinutes: 0, usedMinutes: 0 },
    });

    const delta = newBalanceMinutes - existing.balanceMinutes;

    const h = Math.floor(enteredMinutes / 60);
    const m = enteredMinutes % 60;
    const amtStr = m === 0 ? `${h}h` : `${h}h ${m}m`;
    const modeLabel =
      mode === "ADD" ? `Added ${amtStr}` :
      mode === "SUBTRACT" ? `Subtracted ${amtStr}` :
      `Set available to ${amtStr}`;
    const ledgerNote = `[${modeLabel}] ${note}`;

    await db.$transaction([
      db.leaveBalance.update({
        where: { id: existing.id },
        data: { balanceMinutes: newBalanceMinutes },
      }),
      db.leaveAccrualLedger.create({
        data: {
          employeeId,
          leaveTypeId,
          action: "ADJUSTMENT",
          deltaMinutes: delta,
          balanceAfter: newBalanceMinutes,
          note: ledgerNote,
          createdById: actorId,
        },
      }),
    ]);

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: employeeId,
      action: "LEAVE_BALANCE_ADJUSTED",
      changes: {
        before: { balanceMinutes: existing.balanceMinutes },
        after: { balanceMinutes: newBalanceMinutes, note: ledgerNote },
      },
    });

    revalidatePath(`/admin/employees/${employeeId}`);
  }
);

/** Post a delta ADJUSTMENT entry to correct a gap between expected and actual accrual. */
export const postAccrualCorrection = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { employeeId, leaveTypeId, year, deltaMinutes, note } = postAccrualCorrectionSchema.parse(input);

    if (deltaMinutes === 0) return { success: true as const };

    const existing = await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      update: {},
      create: { employeeId, leaveTypeId, accrualYear: year, balanceMinutes: 0, usedMinutes: 0 },
    });

    const newBalance = existing.balanceMinutes + deltaMinutes;

    await db.$transaction([
      db.leaveBalance.update({
        where: { id: existing.id },
        data: { balanceMinutes: newBalance },
      }),
      db.leaveAccrualLedger.create({
        data: {
          employeeId,
          leaveTypeId,
          action: "ACCRUAL",
          deltaMinutes,
          balanceAfter: newBalance,
          payPeriodEnd: new Date(),
          note: "[Accrual Reset]",
          createdById: actorId,
        },
      }),
    ]);

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: employeeId,
      action: "LEAVE_BALANCE_ADJUSTED",
      changes: {
        before: { balanceMinutes: existing.balanceMinutes },
        after:  { balanceMinutes: newBalance, note: `Accrual correction: ${note}` },
      },
    });

    revalidatePath(`/admin/employees/${employeeId}`);
    return { success: true as const };
  }
);

/** Reset a leave balance to match YTD accruals (sum of ACCRUAL ledger entries for the year). */
export const resetLeaveBalanceToAccrual = withRBAC(
  "EMPLOYEE_MANAGE",
  async (
    { employeeId: actorId, tenantId },
    input: { employeeId: string; leaveTypeId: string; year: number },
  ) => {
    const { employeeId, leaveTypeId, year } = input;

    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd   = new Date(`${year + 1}-01-01T00:00:00Z`);

    const [existing, accrualSum] = await Promise.all([
      db.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      }),
      db.leaveAccrualLedger.aggregate({
        where: { employeeId, leaveTypeId, action: { in: ["ACCRUAL", "EARNED_ADJUSTMENT"] }, payPeriodEnd: { gte: yearStart, lt: yearEnd } },
        _sum: { deltaMinutes: true },
      }),
    ]);

    if (!existing) throw new Error("No balance record found for this leave type and year.");

    // balanceMinutes is the remaining balance (accrued minus used), so subtract usedMinutes
    // so the employee's total on the dashboard reconstructs correctly as accruedMinutes.
    const newBalance = (accrualSum._sum.deltaMinutes ?? 0) - existing.usedMinutes;
    const delta = newBalance - existing.balanceMinutes;

    await db.$transaction([
      db.leaveBalance.update({
        where: { id: existing.id },
        data: { balanceMinutes: newBalance },
      }),
      db.leaveAccrualLedger.create({
        data: {
          employeeId,
          leaveTypeId,
          action: "ADJUSTMENT",
          deltaMinutes: delta,
          balanceAfter: newBalance,
          note: "[Accrual Reset]",
          createdById: actorId,
        },
      }),
    ]);

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: employeeId,
      action: "LEAVE_BALANCE_RESET_TO_ACCRUAL",
      changes: {
        before: { balanceMinutes: existing.balanceMinutes },
        after: { balanceMinutes: newBalance },
      },
    });

    revalidatePath(`/admin/employees/${employeeId}`);
  }
);

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const getAuditLogs = withRBAC(
  "AUDIT_VIEW",
  async ({ tenantId }, input: { page?: number; entityType?: string } = {}) => {
    const page = input.page ?? 1;
    const take = 50;
    const skip = (page - 1) * take;
    const tenantFilter = tenantId ? { tenantId } : {};

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where: {
          ...tenantFilter,
          ...(input.entityType ? { entityType: input.entityType as never } : {}),
        },
        include: { actor: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      db.auditLog.count({
        where: {
          ...tenantFilter,
          ...(input.entityType ? { entityType: input.entityType as never } : {}),
        },
      }),
    ]);

    return { logs, total, page, pages: Math.ceil(total / take) };
  }
);

// ─── Reports ──────────────────────────────────────────────────────────────────

export const getHoursReport = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_actor, input: { payPeriodId: string }) => {
    const payPeriod = await db.payPeriod.findUniqueOrThrow({
      where: { id: input.payPeriodId },
    });

    const [timesheets, ptoBalances] = await Promise.all([
      db.timesheet.findMany({
        where: { payPeriodId: input.payPeriodId },
        include: {
          employee: { include: { user: true, department: true, site: true } },
          overtimeBuckets: true,
        },
        orderBy: { employee: { user: { name: "asc" } } },
      }),
      db.leaveBalance.findMany({
        where: {
          leaveType: { category: "PTO" },
          accrualYear: payPeriod.startDate.getFullYear(),
        },
      }),
    ]);

    const ptoByEmployee: Record<string, number> = {};
    for (const bal of ptoBalances) {
      ptoByEmployee[bal.employeeId] =
        (ptoByEmployee[bal.employeeId] ?? 0) + bal.balanceMinutes;
    }

    return { payPeriod, timesheets, ptoByEmployee };
  }
);

// ─── Bulk CSV employee import ───────────────────────────────────────────────

export const bulkCreateEmployees = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: { rows: CsvEmployeeRow[] }) => {
    if (!tenantId) throw new Error("Tenant context required");
    // 1. Validate every row with Zod
    const rowErrors: { row: number; message: string }[] = [];
    const parsed: CsvEmployeeRow[] = [];

    for (let i = 0; i < input.rows.length; i++) {
      const result = csvEmployeeRowSchema.safeParse(input.rows[i]);
      if (!result.success) {
        const msgs = result.error.issues.map((iss) => iss.message).join("; ");
        rowErrors.push({ row: i + 2, message: msgs }); // +2 for 1-indexed + header
      } else {
        parsed.push(result.data);
      }
    }

    if (rowErrors.length > 0) {
      return { created: 0, errors: rowErrors };
    }

    // 2. Build name→ID lookup maps (case-insensitive)
    const [sites, departments, ruleSets, existingEmployees, customRoles] = await Promise.all([
      db.site.findMany({ where: { isActive: true, tenantId } }),
      db.department.findMany({ where: { isActive: true, tenantId } }),
      db.ruleSet.findMany({ where: { tenantId } }),
      db.employee.findMany({ where: { tenantId }, select: { id: true, employeeCode: true } }),
      db.customRole.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    ]);

    const siteMap = new Map(sites.map((s) => [s.name.toLowerCase(), s.id]));
    const deptMap = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
    const ruleSetMap = new Map(ruleSets.map((r) => [r.name.toLowerCase(), r.id]));
    const existingCodeMap = new Map(existingEmployees.map((e) => [e.employeeCode, e.id]));
    const customRoleMap = new Map(customRoles.map((cr) => [cr.name.toLowerCase(), cr.id]));

    // 3. Resolve references and check for issues
    type ResolvedRow = CsvEmployeeRow & {
      siteId: string;
      departmentId: string;
      ruleSetId: string;
      resolvedRole: string;
      resolvedCustomRoleId: string | null;
    };
    const resolved: ResolvedRow[] = [];

    const seenEmails = new Set<string>();
    const seenCodes = new Set<string>();

    for (let i = 0; i < parsed.length; i++) {
      const r = parsed[i];
      const errors: string[] = [];

      const siteId = siteMap.get(r.site.toLowerCase());
      if (!siteId) errors.push(`Site "${r.site}" not found`);

      const departmentId = deptMap.get(r.department.toLowerCase());
      if (!departmentId) errors.push(`Department "${r.department}" not found`);

      const ruleSetId = ruleSetMap.get(r.ruleSet.toLowerCase());
      if (!ruleSetId) errors.push(`Rule set "${r.ruleSet}" not found`);

      if (r.email) {
        if (seenEmails.has(r.email.toLowerCase())) {
          errors.push(`Duplicate email "${r.email}" in CSV`);
        }
        seenEmails.add(r.email.toLowerCase());
      }

      if (seenCodes.has(r.employeeCode)) {
        errors.push(`Duplicate employee code "${r.employeeCode}" in CSV`);
      }
      seenCodes.add(r.employeeCode);

      // Resolve role: customRole column takes precedence, then role column
      // role column accepts built-in roles (case-insensitive) or custom role names
      let resolvedRole = "EMPLOYEE";
      let resolvedCustomRoleId: string | null = null;

      if (r.customRole) {
        const crId = customRoleMap.get(r.customRole.toLowerCase());
        if (!crId) {
          errors.push(`Custom role "${r.customRole}" not found`);
        } else {
          resolvedCustomRoleId = crId;
        }
      } else if (r.role) {
        const upper = r.role.toUpperCase();
        if (BUILT_IN_ROLES.has(upper)) {
          resolvedRole = upper;
        } else {
          const crId = customRoleMap.get(r.role.toLowerCase());
          if (crId) {
            resolvedCustomRoleId = crId;
          } else {
            errors.push(`Role "${r.role}" is not a valid built-in role or custom role`);
          }
        }
      }

      if (errors.length > 0) {
        rowErrors.push({ row: i + 2, message: errors.join("; ") });
      } else {
        resolved.push({ ...r, siteId: siteId!, departmentId: departmentId!, ruleSetId: ruleSetId!, resolvedRole, resolvedCustomRoleId });
      }
    }

    if (rowErrors.length > 0) {
      return { created: 0, errors: rowErrors };
    }

    // 4. Create in transaction (two-pass for supervisor resolution)
    try {
      const created = await db.$transaction(async (tx) => {
        // Pass 1: create users + employees
        const codeToEmpId = new Map(existingCodeMap);

        for (const r of resolved) {
          let user: Awaited<ReturnType<typeof tx.user.create>>;
          try {
            user = await tx.user.create({
              data: {
                name: r.name,
                ...(r.email && { email: r.email }),
              },
            });
          } catch (createErr: unknown) {
            const msg = createErr instanceof Error ? createErr.message : String(createErr);
            if (msg.includes("Unique constraint") && r.email) {
              throw new Error(`Email already in use: "${r.email}" (employee ${r.employeeCode} — ${r.name})`);
            }
            throw createErr;
          }

          let emp: Awaited<ReturnType<typeof tx.employee.create>>;
          try {
            emp = await tx.employee.create({
            data: {
              userId: user.id,
              tenantId,
              employeeCode: r.employeeCode,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              role: (r.resolvedCustomRoleId ? "EMPLOYEE" : r.resolvedRole) as any,
              customRoleId: r.resolvedCustomRoleId ?? null,
              siteId: r.siteId,
              departmentId: r.departmentId,
              ruleSetId: r.ruleSetId,
              hireDate: parseISO(r.hireDate),
              supervisorId: null,
              wmsId: r.wmsId ?? null,
              payType: r.payType ?? null,
              payRate: r.payRate ?? null,
            },
          });
          } catch (empErr: unknown) {
            const msg = empErr instanceof Error ? empErr.message : String(empErr);
            if (msg.includes("Unique constraint") && msg.includes("wmsId")) {
              throw new Error(`WMS ID already in use: "${r.wmsId}" (employee ${r.employeeCode} — ${r.name})`);
            }
            if (msg.includes("Unique constraint") && msg.includes("employeeCode")) {
              throw new Error(`Employee code already in use: "${r.employeeCode}" (${r.name})`);
            }
            throw empErr;
          }

          codeToEmpId.set(r.employeeCode, emp.id);
        }

        // Pass 2: set supervisor relationships
        for (const r of resolved) {
          if (r.supervisorCode) {
            const supId = codeToEmpId.get(r.supervisorCode);
            if (!supId) {
              throw new Error(
                `Supervisor code "${r.supervisorCode}" not found for employee "${r.employeeCode}"`
              );
            }
            const empId = codeToEmpId.get(r.employeeCode)!;
            await tx.employee.update({
              where: { id: empId },
              data: { supervisorId: supId },
            });
          }
        }

        return resolved.length;
      }, { timeout: 120000 });

      await writeAuditLog({
        tenantId,
        actorId,
        entityType: "EMPLOYEE",
        entityId: "BULK_IMPORT",
        action: "EMPLOYEES_BULK_CREATED",
        changes: { after: { count: created, codes: resolved.map((r) => r.employeeCode) } },
      });

      revalidatePath("/admin/employees");
      return { created, errors: [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error during import";
      return { created: 0, errors: [{ row: 0, message }] };
    }
  }
);

// ─── Manual accrual entry (replaces adjust-balance + clear-manual-adj) ────────

export const postManualAccrualEntry = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { employeeId, leaveTypeId, year, effectiveDate, accrualMinutes, adjustEarnMinutes, adjustMinutes, note } =
      z.object({
        employeeId: z.string(),
        leaveTypeId: z.string(),
        year: z.number().int(),
        effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        accrualMinutes: z.number().int(),
        adjustEarnMinutes: z.number().int().default(0),
        adjustMinutes: z.number().int(),
        note: z.string().min(1),
      }).parse(input);

    if (accrualMinutes === 0 && adjustEarnMinutes === 0 && adjustMinutes === 0) {
      return { success: false as const, error: "Enter a non-zero value for Accrual Hours, Adjust Earn Hours, or Adjust Hours." };
    }

    const existing = await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      update: {},
      create: { employeeId, leaveTypeId, accrualYear: year, balanceMinutes: 0, usedMinutes: 0 },
    });

    const effectiveDateObj = new Date(`${effectiveDate}T00:00:00Z`);
    const newBalance = existing.balanceMinutes + accrualMinutes + adjustEarnMinutes + adjustMinutes;

    const ledgerEntries: {
      employeeId: string; leaveTypeId: string; action: "ACCRUAL" | "EARNED_ADJUSTMENT" | "ADJUSTMENT";
      deltaMinutes: number; balanceAfter: number; payPeriodEnd: Date; note: string; createdById: string | null;
    }[] = [];
    let running = existing.balanceMinutes;

    if (accrualMinutes !== 0) {
      running += accrualMinutes;
      ledgerEntries.push({ employeeId, leaveTypeId, action: "ACCRUAL", deltaMinutes: accrualMinutes, balanceAfter: running, payPeriodEnd: effectiveDateObj, note, createdById: actorId ?? null });
    }
    if (adjustEarnMinutes !== 0) {
      running += adjustEarnMinutes;
      ledgerEntries.push({ employeeId, leaveTypeId, action: "EARNED_ADJUSTMENT", deltaMinutes: adjustEarnMinutes, balanceAfter: running, payPeriodEnd: effectiveDateObj, note, createdById: actorId ?? null });
    }
    if (adjustMinutes !== 0) {
      running += adjustMinutes;
      ledgerEntries.push({ employeeId, leaveTypeId, action: "ADJUSTMENT", deltaMinutes: adjustMinutes, balanceAfter: running, payPeriodEnd: effectiveDateObj, note, createdById: actorId ?? null });
    }

    await db.$transaction([
      db.leaveBalance.update({ where: { id: existing.id }, data: { balanceMinutes: newBalance } }),
      db.leaveAccrualLedger.createMany({ data: ledgerEntries }),
    ]);

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: employeeId,
      action: "LEAVE_BALANCE_ADJUSTED",
      changes: {
        before: { balanceMinutes: existing.balanceMinutes },
        after:  { balanceMinutes: newBalance, note, accrualMinutes, adjustEarnMinutes, adjustMinutes },
      },
    });

    revalidatePath(`/admin/accruals/${employeeId}`);
    return { success: true as const };
  }
);

// ─── Leave ledger drill-down ──────────────────────────────────────────────────

function enumeratePostingDates(
  postingFreq: string,
  cycleAnchor: Date,
  basisDate: Date,
  fromExclusive: Date,
  toInclusive: Date,
): Date[] {
  const ms = 86400000;
  const dates: Date[] = [];
  function push(dt: Date) { if (dt > fromExclusive && dt <= toInclusive) dates.push(dt); }

  switch (postingFreq) {
    case "DAILY": {
      let d = new Date(fromExclusive.getTime() + ms);
      while (d <= toInclusive) { dates.push(new Date(d)); d = new Date(d.getTime() + ms); }
      break;
    }
    case "WEEKLY":
    case "BI_WEEKLY": {
      const period = postingFreq === "WEEKLY" ? 7 : 14;
      const aDay = Math.floor(cycleAnchor.getTime() / ms);
      const fDay = Math.floor(fromExclusive.getTime() / ms) + 1;
      const tDay = Math.floor(toInclusive.getTime() / ms);
      const firstIdx = Math.ceil((fDay - aDay) / period);
      for (let i = firstIdx; ; i++) { const day = aDay + i * period; if (day > tDay) break; dates.push(new Date(day * ms)); }
      break;
    }
    case "SEMI_MONTHLY": {
      for (let y = fromExclusive.getUTCFullYear(); y <= toInclusive.getUTCFullYear(); y++)
        for (let m = 0; m < 12; m++) { push(new Date(Date.UTC(y, m, 1))); push(new Date(Date.UTC(y, m, 15))); }
      break;
    }
    case "MONTHLY": {
      for (let y = fromExclusive.getUTCFullYear(); y <= toInclusive.getUTCFullYear(); y++)
        for (let m = 0; m < 12; m++) push(new Date(Date.UTC(y, m, 1)));
      break;
    }
    case "EVERY_2_MONTHS": {
      for (let y = fromExclusive.getUTCFullYear(); y <= toInclusive.getUTCFullYear(); y++)
        for (const m of [0,2,4,6,8,10]) push(new Date(Date.UTC(y, m, 1)));
      break;
    }
    case "QUARTERLY": {
      for (let y = fromExclusive.getUTCFullYear(); y <= toInclusive.getUTCFullYear(); y++)
        for (const m of [0,3,6,9]) push(new Date(Date.UTC(y, m, 1)));
      break;
    }
    case "EVERY_4_MONTHS": {
      for (let y = fromExclusive.getUTCFullYear(); y <= toInclusive.getUTCFullYear(); y++)
        for (const m of [0,4,8]) push(new Date(Date.UTC(y, m, 1)));
      break;
    }
    case "SEMI_ANNUALLY": {
      for (let y = fromExclusive.getUTCFullYear(); y <= toInclusive.getUTCFullYear(); y++)
        { push(new Date(Date.UTC(y, 0, 1))); push(new Date(Date.UTC(y, 6, 1))); }
      break;
    }
    case "ANNUALLY": {
      for (let y = fromExclusive.getUTCFullYear(); y <= toInclusive.getUTCFullYear(); y++)
        push(new Date(Date.UTC(y, 0, 1)));
      break;
    }
    case "ANNUALLY_HIRE": {
      for (let y = fromExclusive.getUTCFullYear(); y <= toInclusive.getUTCFullYear(); y++)
        push(new Date(Date.UTC(y, basisDate.getUTCMonth(), basisDate.getUTCDate())));
      break;
    }
  }
  return dates;
}

function yearlyRatePerPosting(annualHours: number, freq: string): number {
  const m = annualHours * 60;
  switch (freq) {
    case "DAILY":          return Math.round(m / 365);
    case "WEEKLY":         return Math.round(m / 52);
    case "BI_WEEKLY":      return Math.round(m / 26);
    case "SEMI_MONTHLY":   return Math.round(m / 24);
    case "MONTHLY":        return Math.round(m / 12);
    case "EVERY_2_MONTHS": return Math.round(m / 6);
    case "QUARTERLY":      return Math.round(m / 4);
    case "EVERY_4_MONTHS": return Math.round(m / 3);
    case "SEMI_ANNUALLY":  return Math.round(m / 2);
    default:               return Math.round(m);
  }
}

function ledgerLabel(action: string): string {
  switch (action) {
    case "ACCRUAL":            return "Accrual";
    case "EARNED_ADJUSTMENT":  return "Earned Adj.";
    case "USAGE":              return "Leave Used";
    case "ADJUSTMENT":         return "Adjustment";
    case "CARRY_OVER":         return "Carry Over";
    case "FORFEITURE":         return "Forfeiture";
    case "BALANCE_RESET":      return "Balance Reset";
    case "TIMECARD_DEDUCTION": return "Timecard";
    case "POLICY_CHANGE":      return "Policy Change";
    default:                   return action;
  }
}

export type LedgerDetailEntry = {
  id: string;
  date: string;
  type: string;
  label: string;
  deltaMinutes: number;
  runningBalance: number;
  isFuture: boolean;
  note?: string | null;
  status?: string;
};

// ─── Past-year accrual summary (per-leave-type totals for a completed year) ──

export type PastYearRow = {
  leaveTypeId: string;
  leaveTypeName: string;
  accrualTracked: boolean;
  accruedMinutes: number;
  carryOverMinutes: number;
  adjustedMinutes: number;
  usedMinutes: number;
  finalBalanceMinutes: number;
};

export const getAccrualYearSummary = withRBAC(
  "EMPLOYEE_MANAGE",
  async (_ctx, input: unknown) => {
    const { employeeId, year } = z
      .object({ employeeId: z.string(), year: z.number().int() })
      .parse(input);

    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd   = new Date(`${year + 1}-01-01T00:00:00Z`);

    const [leaveTypes, balances, accrualSums, adjustSums, carryOverSums] = await Promise.all([
      db.leaveType.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, accrualTracked: true },
      }),
      db.leaveBalance.findMany({ where: { employeeId, accrualYear: year } }),
      db.leaveAccrualLedger.groupBy({
        by: ["leaveTypeId"],
        where: { employeeId, action: { in: ["ACCRUAL", "EARNED_ADJUSTMENT"] }, payPeriodEnd: { gte: yearStart, lt: yearEnd } },
        _sum: { deltaMinutes: true },
      }),
      db.leaveAccrualLedger.groupBy({
        by: ["leaveTypeId"],
        where: { employeeId, action: "ADJUSTMENT", createdAt: { gte: yearStart, lt: yearEnd } },
        _sum: { deltaMinutes: true },
      }),
      db.leaveAccrualLedger.groupBy({
        by: ["leaveTypeId"],
        where: { employeeId, action: "CARRY_OVER", createdAt: { gte: yearStart, lt: yearEnd } },
        _sum: { deltaMinutes: true },
      }),
    ]);

    const accrualMap   = new Map(accrualSums.map((s) => [s.leaveTypeId, s._sum.deltaMinutes ?? 0]));
    const adjustMap    = new Map(adjustSums.map((s) => [s.leaveTypeId, s._sum.deltaMinutes ?? 0]));
    const carryOverMap = new Map(carryOverSums.map((s) => [s.leaveTypeId, s._sum.deltaMinutes ?? 0]));

    const rows: PastYearRow[] = leaveTypes
      .map((lt) => {
        const bal       = balances.find((b) => b.leaveTypeId === lt.id);
        const accrued   = accrualMap.get(lt.id) ?? 0;
        const adjusted  = adjustMap.get(lt.id) ?? 0;
        const carryOver = carryOverMap.get(lt.id) ?? 0;
        if (!bal && accrued === 0 && adjusted === 0 && carryOver === 0) return null;
        return {
          leaveTypeId: lt.id,
          leaveTypeName: lt.name,
          accrualTracked: lt.accrualTracked,
          accruedMinutes: accrued,
          carryOverMinutes: carryOver,
          adjustedMinutes: adjusted,
          usedMinutes: bal?.usedMinutes ?? 0,
          finalBalanceMinutes: bal?.balanceMinutes ?? 0,
        };
      })
      .filter((r): r is PastYearRow => r !== null);

    return rows;
  }
);

export const getLeaveTypeLedgerDetail = withRBAC(
  "EMPLOYEE_MANAGE",
  async (_ctx, input: { employeeId: string; leaveTypeId: string; year: number }) => {
    const { employeeId, leaveTypeId, year } = z.object({
      employeeId: z.string(),
      leaveTypeId: z.string(),
      year: z.number().int(),
    }).parse(input);

    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd   = new Date(`${year + 1}-01-01T00:00:00Z`);
    const today     = new Date();
    const ms        = 86400000;
    const todayUtc  = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const [openingEntry, yearEntries, futureRequests, allYearTimestamps, employee] = await Promise.all([
      db.leaveAccrualLedger.findFirst({
        where: { employeeId, leaveTypeId, createdAt: { lt: yearStart }, action: { not: "EOD_SNAPSHOT" } },
        orderBy: { createdAt: "desc" },
        select: { balanceAfter: true },
      }),
      db.leaveAccrualLedger.findMany({
        where: { employeeId, leaveTypeId, createdAt: { gte: yearStart, lt: yearEnd }, action: { not: "EOD_SNAPSHOT" } },
        orderBy: { createdAt: "asc" },
        select: { id: true, action: true, deltaMinutes: true, balanceAfter: true, createdAt: true, note: true },
      }),
      db.leaveRequest.findMany({
        where: { employeeId, leaveTypeId, status: { in: ["APPROVED", "PENDING"] }, startDate: { gte: yearStart, lt: yearEnd } },
        orderBy: { startDate: "asc" },
        select: { id: true, startDate: true, durationMinutes: true, status: true },
      }),
      db.leaveAccrualLedger.findMany({
        where: { employeeId, leaveTypeId, action: { not: "EOD_SNAPSHOT" } },
        select: { createdAt: true },
      }),
      db.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: {
          hireDate: true,
          payCategoryId: true,
          adjustedHireDate: true,
          orientationDate: true,
        },
      }),
    ]);

    // Distinct available years (always include current year)
    const yearSet = new Set(allYearTimestamps.map((e) => e.createdAt.getUTCFullYear()));
    yearSet.add(today.getUTCFullYear());
    const availableYears = [...yearSet].sort((a, b) => b - a);

    const openingBalance = openingEntry?.balanceAfter ?? 0;

    // Build historical entries
    const entries: LedgerDetailEntry[] = yearEntries.map((e) => ({
      id: e.id,
      date: e.createdAt.toISOString().slice(0, 10),
      type: e.action,
      label: ledgerLabel(e.action),
      deltaMinutes: e.deltaMinutes,
      runningBalance: e.balanceAfter,
      isFuture: false,
      note: e.note,
    }));

    // Forecast: only for current or future year
    if (year >= today.getUTCFullYear() && employee.payCategoryId) {
      const payCategory = await db.payCategory.findUnique({
        where: { id: employee.payCategoryId },
        include: {
          ptoPolicies: {
            include: {
              ptoPolicy: {
                select: {
                  rateMode: true,
                  posting1Freq: true,
                  serviceMonthBasis: true,
                  postingAnchorDate: true,
                  forecastEnabled: true,
                  forecastMode: true,
                  forecastMonths: true,
                  rules: {
                    select: { leaveTypeId: true, minTenureMonths: true, maxTenureMonths: true, annualHours: true, earnedHoursPerYear: true },
                    orderBy: { minTenureMonths: "asc" },
                  },
                },
              },
            },
          },
        },
      });

      for (const link of payCategory?.ptoPolicies ?? []) {
        const policy = link.ptoPolicy;
        const rules = policy.rules.filter((r) => r.leaveTypeId === leaveTypeId);
        if (rules.length === 0 || !policy.forecastEnabled) continue;

        const basisDate =
          policy.serviceMonthBasis === "ADJUSTED_HIRE_DATE" ? (employee.adjustedHireDate ?? employee.hireDate) :
          policy.serviceMonthBasis === "ORIENTATION_DATE"   ? (employee.orientationDate ?? employee.hireDate) :
          employee.hireDate;
        const cycleAnchor = policy.postingAnchorDate ?? basisDate;

        const forecastFrom = todayUtc;
        const yearEndDate  = new Date(Date.UTC(year, 11, 31));
        let forecastTo: Date;
        if (policy.forecastMode === "MONTHS" && policy.forecastMonths != null) {
          const candidate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + policy.forecastMonths, today.getUTCDate()));
          forecastTo = candidate < yearEndDate ? candidate : yearEndDate;
        } else {
          forecastTo = yearEndDate;
        }

        if (forecastFrom >= forecastTo) break;

        const postingDates = policy.posting1Freq === "PER_PAY_PERIOD"
          ? []
          : enumeratePostingDates(policy.posting1Freq, cycleAnchor, basisDate, forecastFrom, forecastTo);

        const forecastItems: { date: Date; deltaMinutes: number }[] = [];
        for (const date of postingDates) {
          const tenureMonths = differenceInMonths(date, basisDate);
          const tenureYears  = Math.floor(tenureMonths / 12);
          const tier = rules.find(
            (t) => t.minTenureMonths <= tenureMonths && (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths)
          );
          if (!tier) continue;
          const effectiveHours = tier.annualHours + tenureYears * tier.earnedHoursPerYear;
          if (effectiveHours <= 0) continue;
          const rate = policy.rateMode === "PER_POSTING"
            ? Math.round(effectiveHours * 60)
            : yearlyRatePerPosting(effectiveHours, policy.posting1Freq);
          forecastItems.push({ date, deltaMinutes: rate });
        }

        // Merge future requests + forecast accruals chronologically, compute running balance
        type FutureItem =
          | { kind: "leave"; date: Date; id: string; durationMinutes: number; status: string }
          | { kind: "forecast"; date: Date; deltaMinutes: number };

        const futureItems: FutureItem[] = [
          ...futureRequests.map((r) => ({ kind: "leave" as const, date: r.startDate, id: r.id, durationMinutes: r.durationMinutes, status: r.status })),
          ...forecastItems.map((f) => ({ kind: "forecast" as const, date: f.date, deltaMinutes: f.deltaMinutes })),
        ].sort((a, b) => a.date.getTime() - b.date.getTime());

        let runningBal = yearEntries.length > 0
          ? yearEntries[yearEntries.length - 1].balanceAfter
          : openingBalance;
        let fcIdx = 0;

        for (const item of futureItems) {
          if (item.kind === "leave") {
            runningBal -= item.durationMinutes;
            entries.push({
              id: item.id,
              date: item.date.toISOString().slice(0, 10),
              type: "LEAVE_REQUEST",
              label: item.status === "APPROVED" ? "Approved Leave" : "Pending Leave",
              deltaMinutes: -item.durationMinutes,
              runningBalance: runningBal,
              isFuture: true,
              status: item.status,
            });
          } else {
            runningBal += item.deltaMinutes;
            entries.push({
              id: `fc-${fcIdx++}`,
              date: item.date.toISOString().slice(0, 10),
              type: "FORECAST",
              label: "Forecasted Accrual",
              deltaMinutes: item.deltaMinutes,
              runningBalance: runningBal,
              isFuture: true,
            });
          }
        }

        break; // use first matching policy
      }
    } else {
      // Past year: just add future-approved requests that fall in the year (shouldn't happen but guard)
      let runningBal = yearEntries.length > 0 ? yearEntries[yearEntries.length - 1].balanceAfter : openingBalance;
      for (const r of futureRequests) {
        runningBal -= r.durationMinutes;
        entries.push({
          id: r.id,
          date: r.startDate.toISOString().slice(0, 10),
          type: "LEAVE_REQUEST",
          label: r.status === "APPROVED" ? "Approved Leave" : "Pending Leave",
          deltaMinutes: -r.durationMinutes,
          runningBalance: runningBal,
          isFuture: true,
          status: r.status,
        });
      }
    }

    // Sort by date (historical then future within same day)
    entries.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return Number(a.isFuture) - Number(b.isFuture);
    });

    return { openingBalance, availableYears, entries };
  }
);
