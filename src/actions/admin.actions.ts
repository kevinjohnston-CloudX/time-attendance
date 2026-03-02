"use server";

import bcrypt from "bcryptjs";
import { parseISO } from "date-fns";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
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
  setAnnualLeaveDaysSchema,
  adjustLeaveBalanceSchema,
  csvEmployeeRowSchema,
  type SetAnnualLeaveDaysInput,
  type AdjustLeaveBalanceInput,
  type CsvEmployeeRow,
} from "@/lib/validators/admin.schema";

// ─── Reference data (used by forms) ──────────────────────────────────────────

export const getAdminRefData = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ tenantId }, _input: void) => {
    const t = tenantId ?? undefined;
    const [sites, departments, ruleSets, employees] = await Promise.all([
      db.site.findMany({ where: { isActive: true, tenantId: t }, orderBy: { name: "asc" } }),
      db.department.findMany({
        where: { isActive: true, tenantId: t },
        orderBy: { name: "asc" },
        include: { site: true },
      }),
      db.ruleSet.findMany({ where: { tenantId: t }, orderBy: { name: "asc" } }),
      db.employee.findMany({
        where: { isActive: true, tenantId: t },
        include: { user: true },
        orderBy: { user: { name: "asc" } },
      }),
    ]);
    return { sites, departments, ruleSets, employees };
  }
);

// ─── Employees ────────────────────────────────────────────────────────────────

export const getEmployees = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ tenantId }, _input: void) => {
    return db.employee.findMany({
      where: { tenantId: tenantId ?? undefined },
      include: {
        user: true,
        site: true,
        department: true,
        ruleSet: true,
        supervisor: { include: { user: true } },
      },
      orderBy: { user: { name: "asc" } },
    });
  }
);

export const getEmployeeById = withRBAC(
  "EMPLOYEE_MANAGE",
  async (_actor, input: { employeeId: string }) => {
    return db.employee.findUniqueOrThrow({
      where: { id: input.employeeId },
      include: {
        user: true,
        site: true,
        department: true,
        ruleSet: true,
        supervisor: { include: { user: true } },
      },
    });
  }
);

export const createEmployee = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: CreateEmployeeInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = createEmployeeSchema.parse(input);

    const passwordHash = await bcrypt.hash(parsed.password, 12);

    const employee = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: parsed.name,
          email: parsed.email || null,
          username: parsed.username,
          passwordHash,
        },
      });

      return tx.employee.create({
        data: {
          userId: user.id,
          tenantId,
          employeeCode: parsed.employeeCode,
          role: parsed.role,
          siteId: parsed.siteId,
          departmentId: parsed.departmentId,
          ruleSetId: parsed.ruleSetId,
          hireDate: parseISO(parsed.hireDate),
          supervisorId: parsed.supervisorId ?? null,
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
      employeeId, name, role, supervisorId, siteId, departmentId, ruleSetId, isActive, wmsId, adpWorkerId,
      jobTitle, terminationReason, payType, payRate,
      ssn, phone, phone2, gender, maritalStatus,
      emergencyContact, emergencyPhone, emergencyRelationship,
      address1, address2, city, state, country, zipCode,
    } = updateEmployeeSchema.parse(input);

    const current = await db.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { user: true },
    });

    await db.$transaction(async (tx) => {
      if (name !== undefined) {
        await tx.user.update({ where: { id: current.userId }, data: { name } });
      }
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          ...(role !== undefined && { role }),
          ...(supervisorId !== undefined && { supervisorId }),
          ...(siteId !== undefined && { siteId }),
          ...(departmentId !== undefined && { departmentId }),
          ...(ruleSetId !== undefined && { ruleSetId }),
          ...(isActive !== undefined && { isActive }),
          ...(wmsId !== undefined && { wmsId }),
          ...(adpWorkerId !== undefined && { adpWorkerId }),
          ...(jobTitle !== undefined && { jobTitle }),
          ...(terminationReason !== undefined && { terminationReason }),
          ...(payType !== undefined && { payType }),
          ...(payRate !== undefined && { payRate }),
          ...(ssn !== undefined && { ssn }),
          ...(phone !== undefined && { phone }),
          ...(phone2 !== undefined && { phone2 }),
          ...(gender !== undefined && { gender }),
          ...(maritalStatus !== undefined && { maritalStatus }),
          ...(emergencyContact !== undefined && { emergencyContact }),
          ...(emergencyPhone !== undefined && { emergencyPhone }),
          ...(emergencyRelationship !== undefined && { emergencyRelationship }),
          ...(address1 !== undefined && { address1 }),
          ...(address2 !== undefined && { address2 }),
          ...(city !== undefined && { city }),
          ...(state !== undefined && { state }),
          ...(country !== undefined && { country }),
          ...(zipCode !== undefined && { zipCode }),
        },
      });
    });

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: employeeId,
      action: "EMPLOYEE_UPDATED",
      changes: { before: { role: current.role, isActive: current.isActive } },
    });

    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${employeeId}`);
    return { employeeId };
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
      include: { site: true },
      orderBy: { name: "asc" },
    });
  }
);

export const createDepartment = withRBAC(
  "SITE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: DepartmentInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = departmentSchema.parse(input);
    const dept = await db.department.create({ data: { ...parsed, tenantId } });
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
    const { departmentId, isActive, ...rest } = updateDepartmentSchema.parse(input);
    const updated = await db.department.update({
      where: { id: departmentId },
      data: { ...rest, ...(isActive !== undefined && { isActive }) },
    });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: departmentId,
      action: "DEPARTMENT_UPDATED",
    });
    revalidatePath("/admin/departments");
    return updated;
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
    const lt = await db.leaveType.create({ data: { ...parsed, tenantId } });
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
        annualDaysEntitled: bal?.annualDaysEntitled ?? null,
        year,
      };
    });
  }
);

/** Set (or clear) the annual PTO days for an employee. */
export const setAnnualLeaveDays = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: SetAnnualLeaveDaysInput) => {
    const { employeeId, leaveTypeId, year, annualDays } =
      setAnnualLeaveDaysSchema.parse(input);

    await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      update: { annualDaysEntitled: annualDays },
      create: { employeeId, leaveTypeId, accrualYear: year, balanceMinutes: 0, usedMinutes: 0, annualDaysEntitled: annualDays },
    });

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: employeeId,
      action: "ANNUAL_LEAVE_SET",
      changes: { after: { leaveTypeId, annualDays, year } },
    });

    revalidatePath(`/admin/employees/${employeeId}`);
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
    const [sites, departments, ruleSets, existingEmployees] = await Promise.all([
      db.site.findMany({ where: { isActive: true, tenantId } }),
      db.department.findMany({ where: { isActive: true, tenantId } }),
      db.ruleSet.findMany({ where: { tenantId } }),
      db.employee.findMany({ where: { tenantId }, select: { id: true, employeeCode: true } }),
    ]);

    const siteMap = new Map(sites.map((s) => [s.name.toLowerCase(), s.id]));
    const deptMap = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
    const ruleSetMap = new Map(ruleSets.map((r) => [r.name.toLowerCase(), r.id]));
    const existingCodeMap = new Map(existingEmployees.map((e) => [e.employeeCode, e.id]));

    // 3. Resolve references and check for issues
    type ResolvedRow = CsvEmployeeRow & {
      siteId: string;
      departmentId: string;
      ruleSetId: string;
    };
    const resolved: ResolvedRow[] = [];

    const seenUsernames = new Set<string>();
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

      if (seenUsernames.has(r.username.toLowerCase())) {
        errors.push(`Duplicate username "${r.username}" in CSV`);
      }
      seenUsernames.add(r.username.toLowerCase());

      if (seenCodes.has(r.employeeCode)) {
        errors.push(`Duplicate employee code "${r.employeeCode}" in CSV`);
      }
      seenCodes.add(r.employeeCode);

      if (errors.length > 0) {
        rowErrors.push({ row: i + 2, message: errors.join("; ") });
      } else {
        resolved.push({ ...r, siteId: siteId!, departmentId: departmentId!, ruleSetId: ruleSetId! });
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
          const passwordHash = await bcrypt.hash(r.password, 12);

          const user = await tx.user.create({
            data: {
              name: r.name,
              email: r.email || null,
              username: r.username,
              passwordHash,
            },
          });

          const emp = await tx.employee.create({
            data: {
              userId: user.id,
              tenantId,
              employeeCode: r.employeeCode,
              role: r.role,
              siteId: r.siteId,
              departmentId: r.departmentId,
              ruleSetId: r.ruleSetId,
              hireDate: parseISO(r.hireDate),
              supervisorId: null,
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
