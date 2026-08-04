"use server";

import { parseISO, addMonths, addYears } from "date-fns";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { encryptPiiFields, decryptPiiFields } from "@/lib/crypto/pii";
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
    const [sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories] = await Promise.all([
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
        select: { id: true, name: true },
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
    ]);
    return { sites, departments, ruleSets, employees: employees.map(serializePayRate), customRoles, shifts, holidayRules, payCategories };
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

    const employee = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: parsed.name,
          email: parsed.email,
        },
      });

      return tx.employee.create({
        data: {
          userId: user.id,
          tenantId,
          employeeCode: parsed.employeeCode,
          role: parsed.role,
          customRoleId: parsed.customRoleId ?? null,
          siteId: parsed.siteId,
          departmentId: parsed.departmentId,
          ruleSetId: parsed.ruleSetId,
          hireDate: parseISO(parsed.hireDate),
          supervisorId: parsed.supervisorId ?? null,
          wmsId: parsed.wmsId ?? null,
          payType: parsed.payType ?? null,
          payRate: parsed.payRate ?? null,
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
      employeeId, name, email, role, customRoleId, supervisorId, siteId, departmentId, ruleSetId, shiftId, holidayRuleId, payCategoryId, isActive, wmsId, adpWorkerId,
      jobTitle, terminationReason, payType, payRate,
      phone, phone2, gender, maritalStatus,
      emergencyContact, emergencyPhone, emergencyRelationship,
      address1, address2, city, state, country, zipCode,
    } = updateEmployeeSchema.parse(input);

    const current = await db.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { user: true },
    });

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
          ...(role !== undefined && { role }),
          ...(customRoleId !== undefined && { customRole: customRoleId ? { connect: { id: customRoleId } } : { disconnect: true } }),
          ...(supervisorId !== undefined && { supervisor: supervisorId ? { connect: { id: supervisorId } } : { disconnect: true } }),
          ...(siteId !== undefined && { site: { connect: { id: siteId } } }),
          ...(departmentId !== undefined && { department: { connect: { id: departmentId } } }),
          ...(ruleSetId !== undefined && { ruleSet: { connect: { id: ruleSetId } } }),
          ...(shiftId !== undefined && { shift: shiftId ? { connect: { id: shiftId } } : { disconnect: true } }),
          ...(holidayRuleId !== undefined && { holidayRule: holidayRuleId ? { connect: { id: holidayRuleId } } : { disconnect: true } }),
          ...(payCategoryId !== undefined && { payCategory: payCategoryId ? { connect: { id: payCategoryId } } : { disconnect: true } }),
          ...(isActive !== undefined && { isActive }),
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
    if (role !== undefined) diff("Role", current.role, role);
    if (isActive !== undefined) diff("Status", current.isActive ? "Active" : "Inactive", isActive ? "Active" : "Inactive");
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
    // Fetch employee + current policy override in parallel
    const [employee, override] = await Promise.all([
      db.employee.findUnique({ where: { id: employeeId }, select: { hireDate: true } }),
      db.employeePtoPolicyOverride.findUnique({ where: { employeeId }, select: { ptoPolicyId: true } }),
    ]);
    if (!employee) return [];

    // Fetch policy (with rules), audit entries, and ledger adjustments in parallel
    const [policy, policyAuditEntries, adjustments] = await Promise.all([
      override?.ptoPolicyId
        ? db.ptoPolicy.findUnique({
            where: { id: override.ptoPolicyId },
            select: {
              name: true,
              rules: {
                select: {
                  leaveTypeId: true,
                  minTenureMonths: true,
                  maxTenureMonths: true,
                  annualHours: true,
                  earnedHoursPerYear: true,
                  leaveType: { select: { name: true } },
                },
              },
            },
          })
        : Promise.resolve(null),
      db.auditLog.findMany({
        where: {
          entityId: employeeId,
          action: { in: ["EMPLOYEE_PTO_OVERRIDE_ASSIGNED", "EMPLOYEE_PTO_OVERRIDE_CLEARED"] },
        },
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { user: { select: { name: true } } } } },
      }),
      db.leaveAccrualLedger.findMany({
        where: { employeeId, action: "ADJUSTMENT" },
        orderBy: { createdAt: "desc" },
        include: { leaveType: { select: { name: true } } },
      }),
    ]);

    // Batch-fetch creator names for adjustment entries
    const creatorIds = [...new Set(adjustments.map((a) => a.createdById).filter((id): id is string => !!id))];
    const creatorById = new Map<string, string | null>();
    if (creatorIds.length > 0) {
      const creators = await db.employee.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, user: { select: { name: true } } },
      });
      for (const c of creators) creatorById.set(c.id, c.user.name);
    }

    // Policy name lookup for audit entries (policy may have been deleted/renamed)
    const policyIdSet = new Set<string>();
    for (const e of policyAuditEntries) {
      const pid = (e.changes as { after?: { ptoPolicyId?: string } } | null)?.after?.ptoPolicyId;
      if (pid) policyIdSet.add(pid);
    }
    const policyNamesById = new Map<string, string>();
    if (policyIdSet.size > 0) {
      const policies = await db.ptoPolicy.findMany({
        where: { id: { in: [...policyIdSet] } },
        select: { id: true, name: true },
      });
      for (const p of policies) policyNamesById.set(p.id, p.name);
    }

    type LeaveLogEntry = {
      id: string;
      date: string;
      type: "policy_assigned" | "policy_cleared" | "adjustment" | "tier_change" | "yearly_increase";
      label: string;
      detail: string;
      actorName: string | null;
    };

    const entries: LeaveLogEntry[] = [];

    // Policy change entries
    for (const e of policyAuditEntries) {
      const pid = (e.changes as { after?: { ptoPolicyId?: string } } | null)?.after?.ptoPolicyId;
      entries.push({
        id: e.id,
        date: e.createdAt.toISOString(),
        type: e.action === "EMPLOYEE_PTO_OVERRIDE_ASSIGNED" ? "policy_assigned" : "policy_cleared",
        label: e.action === "EMPLOYEE_PTO_OVERRIDE_ASSIGNED" ? "PTO Policy Assigned" : "PTO Policy Removed",
        detail: pid ? (policyNamesById.get(pid) ?? "Unknown policy") : "Policy removed",
        actorName: e.actor?.user.name ?? null,
      });
    }

    // Manual balance adjustment entries
    for (const a of adjustments) {
      const abs = Math.abs(a.deltaMinutes);
      const h = Math.floor(abs / 60);
      const m = abs % 60;
      const sign = a.deltaMinutes >= 0 ? "+" : "-";
      const fmtDelta = h > 0 && m > 0 ? `${sign}${h}h ${m}m` : h > 0 ? `${sign}${h}h` : `${sign}${m}m`;
      entries.push({
        id: a.id,
        date: a.createdAt.toISOString(),
        type: "adjustment",
        label: "Balance Adjusted",
        detail: `${a.leaveType.name}: ${fmtDelta}${a.note ? ` — ${a.note}` : ""}`,
        actorName: a.createdById ? (creatorById.get(a.createdById) ?? null) : null,
      });
    }

    // Computed tier-change and yearly-increase events from current policy + hire date
    if (policy) {
      const today = new Date();
      const rulesByLeaveType = new Map<string, typeof policy.rules>();
      for (const rule of policy.rules) {
        if (!rulesByLeaveType.has(rule.leaveTypeId)) rulesByLeaveType.set(rule.leaveTypeId, []);
        rulesByLeaveType.get(rule.leaveTypeId)!.push(rule);
      }

      for (const [leaveTypeId, rules] of rulesByLeaveType) {
        const ltName = rules[0].leaveType.name;
        const sortedRules = [...rules].sort((a, b) => a.minTenureMonths - b.minTenureMonths);

        for (const rule of sortedRules) {
          const tierStartDate = addMonths(employee.hireDate, rule.minTenureMonths);
          const tierEndDate = rule.maxTenureMonths != null
            ? addMonths(employee.hireDate, rule.maxTenureMonths)
            : null;

          // Tier change: only for non-initial tiers that have already started
          if (rule.minTenureMonths > 0 && tierStartDate <= today) {
            const tenureYearsAtEntry = Math.floor(rule.minTenureMonths / 12);
            const rateAtEntry = rule.annualHours + tenureYearsAtEntry * rule.earnedHoursPerYear;
            entries.push({
              id: `tier-${leaveTypeId}-${rule.minTenureMonths}`,
              date: tierStartDate.toISOString(),
              type: "tier_change",
              label: "Tier Updated",
              detail: `${ltName}: ${rateAtEntry}h/yr`,
              actorName: null,
            });
          }

          // Yearly rate increases within this tier
          if (rule.earnedHoursPerYear > 0) {
            for (let y = 1; y <= 50; y++) {
              const anniversaryDate = addYears(employee.hireDate, y);
              if (anniversaryDate > today) break;
              // Skip anniversaries that fall on or before tier entry (already reflected in tier_change)
              if (anniversaryDate <= tierStartDate) continue;
              if (tierEndDate && anniversaryDate >= tierEndDate) break;

              const prevRate = rule.annualHours + (y - 1) * rule.earnedHoursPerYear;
              const newRate  = rule.annualHours + y * rule.earnedHoursPerYear;
              entries.push({
                id: `yearly-${leaveTypeId}-${rule.minTenureMonths}-${y}`,
                date: anniversaryDate.toISOString(),
                type: "yearly_increase",
                label: "Annual Rate Increased",
                detail: `${ltName}: ${prevRate}h → ${newRate}h/yr`,
                actorName: null,
              });
            }
          }
        }
      }
    }

    return entries.sort((a, b) => b.date.localeCompare(a.date));
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
        where: { tenantId, externalCode: { not: null } },
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
    revalidatePath("/admin/leave-types");
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
    revalidatePath("/admin/leave-types");
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
    const parsed = ruleSetSchema.parse(input);
    const rs = await db.ruleSet.create({ data: { ...parsed, tenantId } });
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
    const { ruleSetId, ...rest } = updateRuleSetSchema.parse(input);
    const updated = await db.ruleSet.update({ where: { id: ruleSetId }, data: rest });
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
    const { employeeId, leaveTypeId, year, newBalanceMinutes, note } =
      adjustLeaveBalanceSchema.parse(input);

    const existing = await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      update: {},
      create: { employeeId, leaveTypeId, accrualYear: year, balanceMinutes: 0, usedMinutes: 0 },
    });

    const delta = newBalanceMinutes - existing.balanceMinutes;

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
          note,
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
        after: { balanceMinutes: newBalanceMinutes, note },
      },
    });

    revalidatePath(`/admin/employees/${employeeId}`);
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
        where: { employeeId, leaveTypeId, action: "ACCRUAL", payPeriodEnd: { gte: yearStart, lt: yearEnd } },
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
          note: "Reset to accrual",
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
          const user = await tx.user.create({
            data: {
              name: r.name,
              ...(r.email && { email: r.email }),
            },
          });

          const emp = await tx.employee.create({
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
      });

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
