"use server";

import { addMonths, addYears, differenceInMonths } from "date-fns";
import { generatePeriodsForRuleSet } from "@/lib/pay-period-utils";
import { moveTimecardsToRuleSet } from "@/lib/timesheet-migration";
import { z, type ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { cleanEmail, emailHolders } from "@/lib/login-email";
import { Prisma, type AuditEntityType, type Role } from "@prisma/client";
import { publicError, withRBAC } from "@/lib/rbac/guard";
import { zodMessage } from "@/lib/zod-message";
import { photoUrls } from "@/lib/presence/photos";
import { badgeWhere } from "@/lib/utils/badge-lookup";
import { asksForClientBadge, isClientBadge, issueClientBadge } from "@/lib/utils/client-badge";
import { looksLikeBadge } from "@/lib/presence/people-search.service";
import { MISSING_OPTIONS, PAY_OPTIONS, PERIOD_OPTIONS, PUNCH_OPTIONS, SORT_OPTIONS, STATUS_OPTIONS, pick } from "@/components/admin/employees-list-options";
import { writeAuditLog } from "@/lib/audit/logger";
import { ENTITY_TYPES, actionsMatching, isGateAlertSwitch } from "@/lib/audit/labels";
import { startOfDayInTz } from "@/lib/utils/date";
import { encryptPiiFields, decryptPiiFields } from "@/lib/crypto/pii";
import { currentIdentity } from "@/lib/rbac/current";
import { employeeRank, forgetIdentity, type LiveIdentity } from "@/lib/rbac/identity";
import { ROLE_RANK, isValidRole, givesLiveAttendanceRoles, editsPeers } from "@/lib/rbac/roles";
import { todayKey } from "@/lib/pay-rates";
import { personTimeZone, timeZoneLabel } from "@/lib/utils/person-time-zone";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { webPunchByDefault } from "@/lib/web-punch";
import { hoursToSeconds, secondsToMinutes } from "@/lib/leave-time";
import { assertBalanceChangeAllowed, assertNotSenior, assertRecordInReach, assertSiteInReach, siteInReach, siteLimit } from "@/lib/rbac/scope";

// Maps system custom role names to their legacy enum values
/**
 * Whether the signed-in person may hand out this role: it must belong to
 * their company and sit below their own rank. Without it an HR admin could
 * make themselves, or a friend, System Admin. A super admin may give any role.
 */
async function assertAssignable(
  me: LiveIdentity | null,
  tenantId: string,
  role: string | undefined,
  customRoleId: string | null | undefined,
): Promise<void> {
  if (!me) throw new Error("FORBIDDEN");
  let rank: number | null = null;
  if (customRoleId) {
    const cr = await db.customRole.findFirst({ where: { id: customRoleId, tenantId }, select: { rank: true, liveAttendanceOnly: true } });
    if (!cr) throw new Error("That role does not exist");
    if (cr.liveAttendanceOnly && !givesLiveAttendanceRoles(me)) {
      throw new Error("Only a System Admin can give a role limited to Live Attendance");
    }
    rank = cr.rank;
  } else if (role !== undefined) {
    if (role === "SUPER_ADMIN" || !isValidRole(role)) throw new Error("That role cannot be given");
    rank = ROLE_RANK[role];
  }
  if (!me.isSuperAdmin && rank !== null && rank >= me.rank) {
    throw new Error("You can only give a role below your own");
  }
}

/**
 * A job title or agency picked for an employee must be the company's own.
 * Linked by id alone, another company's record could be attached.
 */
async function assertOwnAssignments(
  tenantId: string,
  jobTitleId: string | null | undefined,
  agencyId: string | null | undefined,
): Promise<void> {
  const [jobTitle, agency] = await Promise.all([
    jobTitleId ? db.jobTitle.findFirst({ where: { id: jobTitleId, tenantId }, select: { id: true } }) : true,
    agencyId ? db.agency.findFirst({ where: { id: agencyId, tenantId }, select: { id: true } }) : true,
  ]);
  if (!jobTitle) throw new Error("That job title does not exist");
  if (!agency) throw new Error("That agency does not exist");
}

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

/**
 * A yyyy-MM-dd day as stored: midnight UTC on that day. parseISO read it at
 * midnight on the server's clock, which is only the same thing where the
 * server runs on UTC.
 */
function calendarDay(day: string): Date {
  return new Date(day + "T00:00:00.000Z");
}

/** Today's date for the employee (their own time zone, else their site's), as yyyy-MM-dd. */
async function siteToday(siteId: string | null, ownZone?: string | null): Promise<string> {
  const site = siteId && !ownZone ? await db.site.findUnique({ where: { id: siteId }, select: { timezone: true } }) : null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: personTimeZone({ timeZone: ownZone, site }) }).format(new Date());
}

/** Decimal money columns as plain numbers, so the record can reach a client component. */
function serializePayRate<T extends { payRate: unknown; chargeRate?: unknown; holidayRate?: unknown; overtimeRate?: unknown }>(
  emp: T,
): Omit<T, "payRate" | "chargeRate" | "holidayRate" | "overtimeRate"> & {
  payRate: number | null;
  chargeRate: number | null;
  holidayRate: number | null;
  overtimeRate: number | null;
} {
  const { payRate, chargeRate, holidayRate, overtimeRate, ...rest } = emp;
  const num = (v: unknown) => (v != null ? Number(v) : null);
  return { ...rest, payRate: num(payRate), chargeRate: num(chargeRate), holidayRate: num(holidayRate), overtimeRate: num(overtimeRate) };
}

// ─── Reference data (used by forms) ──────────────────────────────────────────

/**
 * Everyone who can be picked as a supervisor, for the Create employee window
 * on the new design's Employees list, which asks when the window opens rather
 * than sending every name with every page of the list. Same people, same
 * order and the same permission as the list getAdminRefData carries.
 */
export const getSupervisorOptions = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ tenantId }, _input: void) => {
    return db.employee.findMany({
      where: { isActive: true, tenantId: tenantId ?? undefined },
      select: { id: true, user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    });
  }
);

export const getAdminRefData = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ tenantId, employeeId: actorEmpId, role: actorRole }, input: { withEmployees?: boolean } | void) => {
    const t = tenantId ?? undefined;
    // A Payroll or HR Admin held to some sites is offered only those, on the
    // Create window and the employee record (createEmployee and updateEmployee
    // refuse the rest: assertSiteInReach).
    const limit = await siteLimit({ employeeId: actorEmpId, role: actorRole });
    // Every page but the new Employees list still takes the supervisor list
    // from here; that one asks getSupervisorOptions when its window opens.
    const withEmployees = (input && input.withEmployees) ?? true;
    const [sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes, jobTitles, agencies] = await Promise.all([
      db.site.findMany({ where: { isActive: true, tenantId: t, ...(limit ? { id: { in: limit } } : {}) }, orderBy: { name: "asc" } }),
      // Each department's buildings by id and name, which is all the employee
      // forms read (to offer the departments of the building picked). The
      // whole site row on every one of the ~800 links was most of the page.
      db.department.findMany({
        where: { isActive: true, tenantId: t },
        orderBy: { name: "asc" },
        include: { sites: { select: { site: { select: { id: true, name: true } } } } },
      }),
      db.ruleSet.findMany({ where: { tenantId: t }, orderBy: { name: "asc" } }),
      // Only what the Supervisor dropdown draws. This used to be every column
      // on the employee plus the whole user row, which put pay rates, dates of
      // birth, home addresses and password hashes into the page source of
      // every screen that asks for reference data.
      withEmployees
        ? db.employee.findMany({
            where: { isActive: true, tenantId: t },
            select: { id: true, user: { select: { name: true } } },
            orderBy: { user: { name: "asc" } },
          })
        : Promise.resolve([] as { id: string; user: { name: string | null } }[]),
      db.customRole.findMany({
        where: { tenantId: t, isActive: true },
        select: { id: true, name: true, isSystem: true, rank: true, liveAttendanceOnly: true },
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
      db.jobTitle.findMany({
        where: { isActive: true, tenantId: t },
        orderBy: { name: "asc" },
        select: { id: true, name: true, externalId: true },
      }),
      db.agency.findMany({
        where: { tenantId: t },
        orderBy: { code: "asc" },
        select: { id: true, code: true, description: true, inactiveOn: true, defaultMarkupPct: true },
      }),
    ]);
    // No serializePayRate here any more: the rows no longer carry a pay rate
    // to turn from a Decimal into a number.
    // Whether the person looking may pick each role. A role limited to Live
    // Attendance is a System Admin's to give (assertAssignable checks again);
    // the forms leave it out for anyone else, unless the person edited has it.
    const me = await currentIdentity();
    const givesLimited = !!me && givesLiveAttendanceRoles(me);
    const roles = customRoles.map((r) => ({ ...r, givable: !r.liveAttendanceOnly || givesLimited }));
    return {
      sites, departments, ruleSets, employees, customRoles: roles, shifts, holidayRules, payCategories, payTypes, jobTitles,
      // The default markup as a plain number: a Decimal does not cross to the browser.
      agencies: agencies.map((a) => ({ ...a, defaultMarkupPct: a.defaultMarkupPct == null ? null : Number(a.defaultMarkupPct) })),
    };
  }
);

// ─── Employees ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

/** Returns the site IDs an HR_ADMIN or PAYROLL_ADMIN is restricted to, or null if unrestricted. */
async function getActorSiteRestrictions(employeeId: string, role: string): Promise<string[] | null> {
  if (role !== "HR_ADMIN" && role !== "PAYROLL_ADMIN") return null;
  const rows = await db.hrSiteAccess.findMany({
    where: { employeeId },
    select: { siteId: true },
  });
  if (rows.length === 0) return null; // empty = unrestricted
  return rows.map((r) => r.siteId);
}

export const getEmployees = withRBAC(
  "EMPLOYEE_MANAGE",
  async (
    { tenantId, employeeId: actorEmpId, role: actorRole },
    input?: {
      page?: number; q?: string; site?: string; dept?: string; role?: string;
      status?: string; shift?: string; pay?: string; period?: string; punch?: string; missing?: string; sort?: string;
    },
  ) => {
    const { page = 0, q, site, dept, role, shift } = input ?? {};
    // Only the listed choices count; anything else is no filter at all.
    const status = pick(STATUS_OPTIONS, input?.status);
    const pay = pick(PAY_OPTIONS, input?.pay);
    const period = pick(PERIOD_OPTIONS, input?.period);
    const punch = pick(PUNCH_OPTIONS, input?.punch);
    const missing = pick(MISSING_OPTIONS, input?.missing);
    const sort = pick(SORT_OPTIONS, input?.sort);

    const allowedSiteIds = await getActorSiteRestrictions(actorEmpId, actorRole);

    const where: Prisma.EmployeeWhereInput = { tenantId: tenantId ?? undefined };
    // No status picked means current employees (active or on leave), as the
    // list has opened since Job Titles; "Everyone" brings the inactive back.
    if (!status) where.isActive = true;
    if (allowedSiteIds) where.siteId = { in: allowedSiteIds };
    if (site) where.site = { name: site };
    if (dept) where.department = { name: dept };
    if (role) where.role = { equals: role as Prisma.EnumRoleFilter["equals"] };
    // The same three states the Status column shows.
    if (status === "active") Object.assign(where, { isActive: true, onLeave: false });
    if (status === "leave") Object.assign(where, { isActive: true, onLeave: true });
    if (status === "inactive") where.isActive = false;
    if (shift) where.shiftId = shift;
    if (pay) where.payType = pay;
    if (punch) where.webPunchEnabled = punch === "web";
    // Paid on their rule set's pay period, or on the company's when the rule
    // set sets none (most do not: the company's is biweekly).
    if (period) {
      const company = tenantId ? await db.tenant.findUnique({ where: { id: tenantId }, select: { payFrequency: true } }) : null;
      where.ruleSet = company?.payFrequency === period
        ? { OR: [{ payFrequency: period }, { payFrequency: null }] }
        : { payFrequency: period };
    }
    // No badge means neither an employee number nor a barcode, so the time
    // clock has nothing to match a scan to.
    if (missing === "badge") Object.assign(where, { wmsId: null, barcode: null });
    if (missing === "shift" && !shift) where.shiftId = null;
    if (missing === "supervisor") where.supervisorId = null;
    if (missing === "pay" && !pay) where.payType = null;

    // Name, then id, behind every order, so a page boundary never splits or
    // repeats a run of equal values.
    const byName: Prisma.EmployeeOrderByWithRelationInput[] = [{ user: { name: "asc" } }, { id: "asc" }];
    const orderBy: Prisma.EmployeeOrderByWithRelationInput[] =
      sort === "name" ? byName
      : sort === "code" ? [{ employeeCode: "asc" }, { id: "asc" }]
      : sort === "dept" ? [{ department: { name: "asc" } }, ...byName]
      : sort === "hired" ? [{ hireDate: "desc" }, ...byName]
      : sort === "added" ? [{ createdAt: "desc" }, { id: "asc" }]
      : [{ isActive: "desc" }, ...byName];
    if (q) {
      where.OR = [
        { user: { name: { contains: q, mode: "insensitive" } } },
        { user: { email: { contains: q, mode: "insensitive" } } },
        { user: { workEmail: { contains: q, mode: "insensitive" } } },
        { employeeCode: { contains: q, mode: "insensitive" } },
        // A badge number or barcode, matched the way the kiosks match a scan
        // (zero padding and re-issued cards included), as Live Attendance does.
        ...(looksLikeBadge(q) ? [badgeWhere(q)] : []),
      ];
    }

    // Exactly the columns the roster table draws, and nothing else. It used
    // to take every column on the employee, the whole user row, the site, the
    // department, the rule set and the supervisor with their user row too, so
    // a page of 100 people carried 100 password hashes and 100 pay rates into
    // the browser to render a name, a code and a department.
    const [rows, total] = await Promise.all([
      db.employee.findMany({
        where,
        select: {
          id: true,
          employeeCode: true,
          role: true,
          isActive: true,
          onLeave: true,
          shiftId: true,
          // Shown under the role in the list.
          hireDate: true,
          user:       { select: { name: true, email: true, workEmail: true } },
          site:       { select: { name: true } },
          department: { select: { name: true } },
          customRole: { select: { id: true, name: true } },
          // The barcode only finds each person's tablet photo and is dropped
          // below. The WMS badge ID stays: it is the Badge ID column, and
          // this list is behind EMPLOYEE_MANAGE, whose holders see and edit
          // it on every record already.
          barcode: true,
          wmsId: true,
        },
        orderBy,
        take: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      }),
      db.employee.count({ where }),
    ]);

    let photos = new Map<string, string | null>();
    try {
      photos = await photoUrls(tenantId ?? "", rows);
    } catch {
      // A failed lookup costs the faces, never the list.
    }
    const employees = rows.map(({ barcode: _barcode, ...row }) => ({
      ...row,
      photo: photos.get(row.id) ?? null,
    }));

    return { employees, total, page, pageSize: PAGE_SIZE };
  }
);

export const getEmployeeById = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, input: { employeeId: string }) => {
    await assertRecordInReach(actor, input.employeeId);
    const emp = await db.employee.findUniqueOrThrow({
      where: { id: input.employeeId },
      include: {
        // Name and the two emails are the only user fields the edit form
        // draws, and the whole row carries the password hash into the page source.
        user: { select: { id: true, name: true, email: true, workEmail: true } },
        site: true,
        department: true,
        ruleSet: true,
        supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
    const serialized = serializePayRate(decryptPiiFields(emp));
    return { ...serialized, supervisor: serialized.supervisor ? serializePayRate(serialized.supervisor) : null };
  }
);

/**
 * A person's two sign in emails, checked before a save: at least one, not the
 * same address twice, and neither one already someone else's (in either of
 * their two, ignoring capitals). The database refuses a clash too; this says
 * who has it. A name only from this company; anyone else stays unnamed.
 *
 * <p>`changed` is what to look up: only the addresses being set now. An
 * address already on the person is never held against them, which matters for
 * the few old logins that differ from another only by capitals.
 */
async function assertEmailsFree(
  personal: string | null,
  work: string | null,
  exceptUserId: string | null,
  tenantId: string,
  changed: (string | null)[] = [work, personal],
) {
  if (!personal && !work) throw new Error("Add a work email or a personal email. The person signs in with either one.");
  if (personal && work && personal.toLowerCase() === work.toLowerCase()) {
    throw new Error("The work email and the personal email are the same address. Keep it in one of them.");
  }
  const holders = await emailHolders(changed, exceptUserId);
  for (const address of changed) {
    const owner = address ? holders.get(address.toLowerCase()) : undefined;
    if (owner) {
      const who = owner.tenantId === tenantId && owner.name ? owner.name : "another account";
      throw new Error(`The email ${address} is already used by ${who}.`);
    }
  }
}

export const createEmployee = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, input: CreateEmployeeInput) => {
    const { employeeId: actorId, tenantId } = actor;
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = createEmployeeSchema.parse(input);
    await assertSiteInReach(actor, parsed.siteId);
    await assertAssignable(await currentIdentity(), tenantId, parsed.role, parsed.customRoleId);
    await assertOwnAssignments(tenantId, parsed.jobTitleId, parsed.agencyId);

    // Auto-assign the system custom role when only a role enum is provided
    let resolvedCustomRoleId = parsed.customRoleId ?? null;
    let resolvedRole = parsed.role;
    // The role by the name people see, for the audit log.
    let roleName: string | null = null;
    if (!resolvedCustomRoleId) {
      const systemName = Object.entries(SYSTEM_ROLE_NAME_TO_ENUM).find(([, v]) => v === parsed.role)?.[0];
      if (systemName) {
        const systemRole = await db.customRole.findFirst({
          where: { tenantId, isSystem: true, name: systemName, isActive: true },
          select: { id: true },
        });
        resolvedCustomRoleId = systemRole?.id ?? null;
        roleName = systemRole ? systemName : null;
      }
    } else {
      // Derive role enum from the provided customRoleId
      const cr = await db.customRole.findFirst({ where: { id: resolvedCustomRoleId, tenantId }, select: { isSystem: true, name: true } });
      resolvedRole = (cr?.isSystem ? (SYSTEM_ROLE_NAME_TO_ENUM[cr.name] ?? "EMPLOYEE") : "EMPLOYEE") as typeof parsed.role;
      roleName = cr?.name ?? null;
    }

    // "CL" as the Badge ID asks for the next client badge, issued inside the
    // transaction below (client-badge.ts). "CL" as the employee code too means
    // the code is that badge.
    const issuing = asksForClientBadge(parsed.wmsId);
    const ownCode = asksForClientBadge(parsed.employeeCode) ? undefined : parsed.employeeCode;

    // A Badge ID or login email already on file is said in words, with who has
    // it: the database refusal reached the screen only as "Something went
    // wrong". Mostly a rehire whose old record is inactive (Fidella Rios,
    // 639608, from the NovaTime import), who should be made active instead.
    const badge = ownCode || (issuing ? undefined : parsed.wmsId);
    if (badge) {
      const taken = await db.employee.findFirst({
        where: { tenantId, OR: [{ employeeCode: badge }, { wmsId: badge }] },
        select: { isActive: true, user: { select: { name: true } } },
      });
      if (taken) {
        const who = taken.user?.name ?? "another employee";
        throw new Error(
          taken.isActive
            ? `Badge ID ${badge} is already in use by ${who}.`
            : `Badge ID ${badge} is already in use by ${who} (inactive). Open their record and make them active instead of adding them again.`,
        );
      }
    }
    // Either email signs the person in, so one is needed, and neither may
    // belong to anyone else (in either of their two, ignoring capitals).
    const personalEmail = cleanEmail(parsed.email, "personal");
    const workEmail = cleanEmail(parsed.workEmail, "work");
    // A client badge signs nobody in, so a client may have neither.
    const client = issuing || isClientBadge(parsed.wmsId);
    if (personalEmail || workEmail || !client) await assertEmailsFree(personalEmail, workEmail, null, tenantId);

    const employee = await db.$transaction(async (tx) => {
      const wmsId = issuing ? await issueClientBadge(tx) : parsed.wmsId ?? null;
      const user = await tx.user.create({
        data: {
          name: parsed.name,
          email: personalEmail,
          workEmail,
        },
      });

      const encPii = encryptPiiFields({
        phone: parsed.phone, phone2: parsed.phone2, gender: parsed.gender, maritalStatus: parsed.maritalStatus,
        emergencyContact: parsed.emergencyContact, emergencyPhone: parsed.emergencyPhone, emergencyRelationship: parsed.emergencyRelationship,
        address1: parsed.address1, address2: parsed.address2, city: parsed.city, state: parsed.state, country: parsed.country, zipCode: parsed.zipCode,
      });

      const employeeCode = ownCode || wmsId || `EMP-${Date.now()}`;

      return tx.employee.create({
        data: {
          userId: user.id,
          tenantId,
          employeeCode,
          role: resolvedRole,
          customRoleId: resolvedCustomRoleId,
          // Admins start able to punch from the web; everyone else at the time clock.
          webPunchEnabled: webPunchByDefault(resolvedRole),
          siteId: parsed.siteId,
          departmentId: parsed.departmentId,
          ruleSetId: parsed.ruleSetId,
          hireDate: calendarDay(parsed.hireDate),
          supervisorId: parsed.supervisorId ?? null,
          wmsId,
          payType: parsed.payType ?? null,
          payRate: parsed.payRate ?? null,
          ...(parsed.payRate
            ? { payRates: { create: { effectiveDate: new Date(`${parsed.hireDate}T00:00:00.000Z`), rate1: parsed.payRate, createdById: actorId || null } } }
            : {}),
          jobTitle: parsed.jobTitle ?? null,
          jobTitleId: parsed.jobTitleId ?? null,
          agencyId: parsed.agencyId ?? null,
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
      changes: {
        after: {
          employeeCode: employee.employeeCode,
          role: roleName ?? resolvedRole,
          ...(issuing && { clientBadge: employee.wmsId }),
        },
      },
    });

    revalidatePath("/admin/employees");
    return employee;
  }
);

export const updateEmployee = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, input: UpdateEmployeeInput) => {
    const { employeeId: actorId, tenantId } = actor;
    const {
      employeeId, name, email, workEmail, role, customRoleId, supervisorId, siteId, departmentId, ruleSetId, shiftId, holidayRuleId, payCategoryId, payTypeId, isActive, onLeave, webPunchEnabled, wmsId, barcode, adpWorkerId,
      adjustedHireDate, jobTitle, jobTitleId, agencyId, terminationReason, terminatedAt: terminatedAtInput, timeZone, payType, payRate, chargeRate, holidayRate, overtimeRate,
      phone, phone2, gender, maritalStatus,
      emergencyContact, emergencyPhone, emergencyRelationship,
      address1, address2, city, state, country, zipCode,
    } = updateEmployeeSchema.parse(input);

    if (!tenantId) throw new Error("Tenant context required");
    await assertRecordInReach(actor, employeeId);
    const current = await db.employee.findFirst({
      where: { id: employeeId, tenantId },
      include: { user: true, customRole: { select: { name: true } } },
    });
    await assertOwnAssignments(tenantId, jobTitleId, agencyId);
    if (!current) throw new Error("NOT_FOUND");
    if (siteId !== undefined && siteId !== current.siteId) await assertSiteInReach(actor, siteId);

    // The termination date follows the status. Made inactive: the date given,
    // or today at their site. Made active again: cleared, since the time clock
    // and the gate treat anyone with a termination date as gone, and a rehire
    // kept their old one (the old date stays in the audit history). An active
    // person never carries one, so a date sent for them is not kept.
    const willBeActive = isActive ?? current.isActive;
    const currentTermDay = current.terminatedAt ? current.terminatedAt.toISOString().slice(0, 10) : null;
    let terminatedAt: string | null | undefined = undefined;
    if (willBeActive) {
      if (currentTermDay) terminatedAt = null;
    } else if (terminatedAtInput !== undefined) {
      terminatedAt = terminatedAtInput ?? (currentTermDay || (await siteToday(current.siteId, current.timeZone)));
    } else if (current.isActive) {
      terminatedAt = await siteToday(current.siteId, current.timeZone);
    }
    if (terminatedAt !== undefined && terminatedAt === currentTermDay) terminatedAt = undefined;

    // The two sign in emails as they will be after this save. Blank clears
    // one; at least one stays, and a new address must not be anyone else's.
    const nextPersonal = email === undefined ? current.user.email : cleanEmail(email, "personal");
    const nextWork = workEmail === undefined ? current.user.workEmail : cleanEmail(workEmail, "work");
    const personalChanged = (nextPersonal ?? null) !== (current.user.email ?? null);
    const workChanged = (nextWork ?? null) !== (current.user.workEmail ?? null);

    // Who may change what. Nobody changes their own role, status, pay or
    // supervisor. Nobody edits someone senior to them. With a peer, only the
    // everyday fields: not their emails (either one signs them in), role,
    // status or pay. A super admin may do anything.
    const me = await currentIdentity();
    if (!me) throw new Error("FORBIDDEN");
    const roleChanges =
      (role !== undefined && role !== current.role) ||
      (customRoleId !== undefined && (customRoleId ?? null) !== current.customRoleId);
    const moneyChanges = (next: number | null | undefined, cur: unknown) =>
      next !== undefined && (next ?? null) !== (cur == null ? null : Number(cur));
    const sensitive =
      roleChanges ||
      (isActive !== undefined && isActive !== current.isActive) ||
      terminatedAt !== undefined ||
      (payType !== undefined && payType !== current.payType) ||
      moneyChanges(payRate, current.payRate) ||
      // Informational, but still pay: the same people may change them
      moneyChanges(chargeRate, current.chargeRate) ||
      moneyChanges(holidayRate, current.holidayRate) ||
      moneyChanges(overtimeRate, current.overtimeRate);
    if (!me.isSuperAdmin) {
      if (me.employeeId === employeeId) {
        if (sensitive || (supervisorId !== undefined && (supervisorId ?? null) !== current.supervisorId)) {
          throw new Error("You can't change your own role, status, pay or supervisor");
        }
      } else {
        const theirs = await employeeRank(employeeId, tenantId);
        if (theirs === null || theirs > me.rank) throw new Error("Only someone more senior can edit this person");
        if (theirs === me.rank && !editsPeers(me.rank) && (sensitive || personalChanged || workChanged)) {
          throw new Error("Only someone more senior can change this person's email, role, status or pay");
        }
      }
    }
    if (roleChanges) await assertAssignable(me, tenantId, role, customRoleId);
    // "CL" as the Badge ID asks for the next client badge, issued in the
    // transaction below (client-badge.ts). A client badge signs nobody in, so
    // a client may clear both emails.
    const issuing = asksForClientBadge(wmsId);
    const client = issuing || isClientBadge(wmsId === undefined ? current.wmsId : wmsId);
    let issuedBadge: string | null = null;
    if ((personalChanged || workChanged) && (nextPersonal || nextWork || !client)) {
      await assertEmailsFree(nextPersonal, nextWork, current.userId, tenantId, [
        personalChanged ? nextPersonal : null,
        workChanged ? nextWork : null,
      ]);
    }

    // Derive the role enum from the custom role when customRoleId is being set
    let derivedRole: string | undefined = role;
    // The role by the name people see, for the audit log. The level alone
    // cannot tell a custom role such as Loss Prevention from Employee.
    let newRoleName: string | null | undefined;
    if (customRoleId !== undefined && customRoleId !== null) {
      const cr = await db.customRole.findFirst({
        where: { id: customRoleId, tenantId },
        select: { isSystem: true, name: true },
      });
      derivedRole = cr?.isSystem ? (SYSTEM_ROLE_NAME_TO_ENUM[cr.name] ?? "EMPLOYEE") : "EMPLOYEE";
      newRoleName = cr?.name ?? null;
    } else if (customRoleId === null) {
      newRoleName = null;
    }

    await db.$transaction(async (tx) => {
      if (issuing) issuedBadge = await issueClientBadge(tx);
      if (name !== undefined || personalChanged || workChanged) {
        await tx.user.update({
          where: { id: current.userId },
          data: {
            ...(name !== undefined && { name }),
            ...(personalChanged && { email: nextPersonal }),
            ...(workChanged && { workEmail: nextWork }),
          },
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
          ...(webPunchEnabled !== undefined && { webPunchEnabled }),
          ...(wmsId !== undefined && { wmsId: issuedBadge ?? wmsId }),
          // A barcode set by hand is marked as an override so the Oracle sync
          // leaves it alone — otherwise a deliberate correction would be undone
          // on the next run and nobody would know why the badge stopped working.
          ...(barcode !== undefined && {
            barcode: barcode || null,
            barcodeOverride: Boolean(barcode),
          }),
          ...(adpWorkerId !== undefined && { adpWorkerId }),
          ...(adjustedHireDate !== undefined && { adjustedHireDate: adjustedHireDate ? calendarDay(adjustedHireDate) : null }),
          ...(jobTitle !== undefined && { jobTitle }),
          ...(jobTitleId !== undefined && { jobTitleRef: jobTitleId ? { connect: { id: jobTitleId } } : { disconnect: true } }),
          ...(agencyId !== undefined && { agencyRef: agencyId ? { connect: { id: agencyId } } : { disconnect: true } }),
          ...(terminationReason !== undefined && { terminationReason }),
          ...(terminatedAt !== undefined && { terminatedAt: terminatedAt ? new Date(terminatedAt + "T00:00:00.000Z") : null }),
          ...(timeZone !== undefined && { timeZone }),
          ...(payType !== undefined && { payType }),
          ...(payRate !== undefined && { payRate }),
          ...(chargeRate !== undefined && { chargeRate }),
          ...(holidayRate !== undefined && { holidayRate }),
          ...(overtimeRate !== undefined && { overtimeRate }),
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

    // A rate set here (rather than in the pay rates table) is recorded as of today.
    const newRate = payRate ?? null;
    const oldRate = current.payRate === null ? null : Number(current.payRate);
    if (payRate !== undefined && newRate !== null && newRate !== oldRate) {
      const today = new Date(`${todayKey()}T00:00:00.000Z`);
      await db.employeePayRate.upsert({
        where: { employeeId_effectiveDate: { employeeId, effectiveDate: today } },
        create: { employeeId, effectiveDate: today, rate1: newRate, createdById: actorId || null },
        update: { rate1: newRate },
      });
    }

    // When the rule set changes, write a history record (for split-segment logic) and
    // move the open timecards to the new rule set's pay periods, day by day.
    if (ruleSetId !== undefined && ruleSetId !== current.ruleSetId) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      await db.employeeRuleSetHistory.create({
        data: { employeeId, ruleSetId, effectiveDate: today, createdById: actorId },
      });

      const newRuleSet = await db.ruleSet.findUnique({ where: { id: ruleSetId } });
      if (newRuleSet) await moveTimecardsToRuleSet(employeeId, newRuleSet, actorId ?? null);
    }

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
    if (personalChanged) diff("Personal email", current.user.email, nextPersonal);
    if (workChanged) diff("Work email", current.user.workEmail, nextWork);
    if (newRoleName !== undefined) {
      diff("Role", current.customRole?.name ?? current.role, newRoleName ?? derivedRole ?? current.role);
    } else if (derivedRole !== undefined) {
      diff("Role", current.role, derivedRole);
    }
    const statusLabel = (active: boolean, leave: boolean) => !active ? "Inactive" : leave ? "On Leave" : "Active";
    if (isActive !== undefined || onLeave !== undefined) {
      const newActive = isActive ?? current.isActive;
      const newLeave = onLeave ?? current.onLeave;
      diff("Status", statusLabel(current.isActive, current.onLeave), statusLabel(newActive, newLeave));
    }
    const punchLabel = (on: boolean) => (on ? "Allowed" : "Time clock only");
    if (webPunchEnabled !== undefined) diff("Punching from the web", punchLabel(current.webPunchEnabled), punchLabel(webPunchEnabled));
    if (jobTitle !== undefined) diff("Job Title", current.jobTitle, jobTitle);
    if (wmsId !== undefined) diff("Badge ID (WMS)", current.wmsId, issuedBadge ?? wmsId);
    if (barcode !== undefined) diff("Badge barcode", current.barcode, barcode);
    if (adpWorkerId !== undefined) diff("ADP Worker ID", current.adpWorkerId, adpWorkerId);
    if (terminationReason !== undefined) diff("Termination Reason", current.terminationReason, terminationReason);
    if (terminatedAt !== undefined) diff("Termination Date", currentTermDay, terminatedAt);
    if (adjustedHireDate !== undefined) {
      diff("Adjusted Hire Date", current.adjustedHireDate ? current.adjustedHireDate.toISOString().slice(0, 10) : null, adjustedHireDate);
    }
    if (payType !== undefined) diff("Pay Type", current.payType, payType);
    if (payRate !== undefined) {
      const cur = current.payRate != null ? parseFloat(String(current.payRate)) : null;
      if (cur !== payRate) diff("Pay Rate", cur != null ? `$${cur.toFixed(2)}` : null, payRate != null ? `$${payRate.toFixed(2)}` : null);
    }
    const usd = (v: unknown) => (v != null ? `$${Number(v).toFixed(2)}` : null);
    if (moneyChanges(chargeRate, current.chargeRate)) diff("Charge Rate", usd(current.chargeRate), usd(chargeRate));
    if (moneyChanges(holidayRate, current.holidayRate)) diff("Holiday Rate", usd(current.holidayRate), usd(holidayRate));
    if (moneyChanges(overtimeRate, current.overtimeRate)) diff("Overtime Rate", usd(current.overtimeRate), usd(overtimeRate));
    if (timeZone !== undefined) diff("Time Zone", current.timeZone ? timeZoneLabel(current.timeZone) : "Site's time zone", timeZone ? timeZoneLabel(timeZone) : "Site's time zone");
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
        c ? `${c.number}${c.description ? ` (${c.description})` : ""}` : null;
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
                select: { balanceSeconds: true },
              });

              await db.leaveAccrualLedger.create({
                data: {
                  employeeId,
                  leaveTypeId,
                  action: "POLICY_CHANGE",
                  deltaSeconds: hoursToSeconds(effectiveAnnualHours),
                  balanceAfterSeconds: currentBalance?.balanceSeconds ?? 0,
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
    const currentJobTitleId = (current as { jobTitleId?: string | null }).jobTitleId ?? null;
    if (jobTitleId !== undefined && jobTitleId !== currentJobTitleId) {
      const [from, to] = await Promise.all([
        currentJobTitleId ? db.jobTitle.findUnique({ where: { id: currentJobTitleId }, select: { name: true } }) : Promise.resolve(null),
        jobTitleId ? db.jobTitle.findUnique({ where: { id: jobTitleId }, select: { name: true } }) : Promise.resolve(null),
      ]);
      diff("Job Title", from?.name, to?.name);
    }
    const currentAgencyId = (current as { agencyId?: string | null }).agencyId ?? null;
    if (agencyId !== undefined && agencyId !== currentAgencyId) {
      const [from, to] = await Promise.all([
        currentAgencyId ? db.agency.findUnique({ where: { id: currentAgencyId }, select: { code: true, description: true } }) : Promise.resolve(null),
        agencyId ? db.agency.findUnique({ where: { id: agencyId }, select: { code: true, description: true } }) : Promise.resolve(null),
      ]);
      const fmt = (a: { code: number; description: string } | null) => a ? `${a.code} (${a.description})` : null;
      diff("Agency", fmt(from), fmt(to));
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

    // A new time zone moves where their days start and end: their open
    // timecards are recalculated now rather than at their next punch.
    // Not for someone inactive: their timecards stay as they were when they left.
    if (timeZone !== undefined && timeZone !== current.timeZone && willBeActive) {
      const open = await db.timesheet.findMany({
        where: { employeeId, status: { notIn: ["LOCKED", "PAYROLL_APPROVED"] }, payPeriod: { status: "OPEN" } },
        select: { id: true, employee: { select: { ruleSet: true } } },
      });
      for (const t of open) await rebuildSegments(t.id, t.employee.ruleSet).catch(() => {});
    }

    // A role or status change reaches their next click, not the next cache refresh.
    forgetIdentity(current.userId);
    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${employeeId}`);
    return { employeeId };
  }
);

// ─── HR Site Access ───────────────────────────────────────────────────────────

export const getHrSiteAccess = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, { employeeId }: { employeeId: string }) => {
    const { tenantId } = actor;
    if (!tenantId) throw new Error("NOT_FOUND");
    await assertRecordInReach(actor, employeeId);
    // Held to the company: the id comes from the browser.
    const rows = await db.hrSiteAccess.findMany({
      where: { employeeId, employee: { tenantId } },
      select: { siteId: true },
    });
    return rows.map((r) => r.siteId);
  }
);

export const updateHrSiteAccess = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, input: { employeeId: string; siteIds: string[] }) => {
    const { tenantId, role: actorRole } = actor;
    const { employeeId, siteIds } = input;
    // HR and System Admins only, their own record included. A Payroll Admin
    // could clear their own site limit here, or anyone's, which undid it.
    if (actorRole !== "SYSTEM_ADMIN" && actorRole !== "HR_ADMIN" && actorRole !== "SUPER_ADMIN") {
      throw new Error("Only HR Admin or System Admin users can edit site access.");
    }
    if (!tenantId) throw new Error("NOT_FOUND");
    // The person whose access is replaced has to be in this company too, not
    // only the sites: the id comes from the browser.
    await assertRecordInReach(actor, employeeId);
    // Nor someone ranked above them: an HR Admin does not set a System Admin's.
    await assertNotSenior(actor, employeeId);

    // Verify siteIds belong to this tenant
    const validSites = await db.site.findMany({
      where: { tenantId, id: { in: siteIds } },
      select: { id: true },
    });
    const validIds = new Set(validSites.map((s) => s.id));
    let safeIds = siteIds.filter((id) => validIds.has(id));

    // An HR Admin held to some sites gives access to those alone, and is
    // shown no others (getAdminRefData): the person's sites beyond them are
    // kept, not dropped. Nor may they leave someone with no sites, which
    // means every site.
    const limit = await siteLimit(actor);
    if (limit) {
      if (safeIds.some((id) => !limit.includes(id))) throw new Error("You can only give access to your own sites.");
      const beyond = await db.hrSiteAccess.findMany({ where: { employeeId, siteId: { notIn: limit } }, select: { siteId: true } });
      safeIds = [...safeIds, ...beyond.map((r) => r.siteId)];
      if (safeIds.length === 0) throw new Error("Pick at least one site. No sites means every site, which is more than you can reach.");
    }

    // Replace: delete existing, create new
    await db.$transaction([
      db.hrSiteAccess.deleteMany({ where: { employeeId } }),
      ...(safeIds.length > 0
        ? [db.hrSiteAccess.createMany({ data: safeIds.map((siteId) => ({ employeeId, siteId })) })]
        : []),
    ]);

    revalidatePath("/admin/employees");
    return { siteIds: safeIds };
  }
);

// ─── Additional supervisors ───────────────────────────────────────────────────

/**
 * An employee's supervisors besides the supervisor of record: each sees them
 * on their team screens, with what their own role allows.
 */
export const getAdditionalSupervisors = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, { employeeId }: { employeeId: string }) => {
    const { tenantId } = actor;
    if (!tenantId) throw new Error("NOT_FOUND");
    await assertRecordInReach(actor, employeeId);
    // Held to the company: the id comes from the browser.
    const rows = await db.employeeSupervisor.findMany({
      where: { employeeId, employee: { tenantId } },
      select: { supervisor: { select: { id: true, isActive: true, user: { select: { name: true } } } } },
    });
    return rows
      .map((r) => ({ id: r.supervisor.id, name: r.supervisor.user?.name ?? r.supervisor.id, isActive: r.supervisor.isActive }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
);

export const updateAdditionalSupervisors = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, input: { employeeId: string; supervisorIds: string[] }) => {
    const { tenantId, employeeId: actorId } = actor;
    const { employeeId } = input;
    if (!tenantId) throw new Error("NOT_FOUND");
    await assertRecordInReach(actor, employeeId);
    const own = await db.employee.findFirst({ where: { id: employeeId, tenantId }, select: { id: true, supervisorId: true } });
    if (!own) throw new Error("NOT_FOUND");

    // Never the person themselves, nor their supervisor of record (already
    // their supervisor), and only people in this company.
    const wanted = [...new Set(input.supervisorIds)].filter((id) => id !== employeeId && id !== own.supervisorId);
    const valid = await db.employee.findMany({ where: { tenantId, id: { in: wanted } }, select: { id: true } });
    const validIds = new Set(valid.map((e) => e.id));
    const next = wanted.filter((id) => validIds.has(id));

    const current = await db.employeeSupervisor.findMany({ where: { employeeId }, select: { supervisorId: true } });
    const before = new Set(current.map((c) => c.supervisorId));
    const toAdd = next.filter((id) => !before.has(id));
    const toRemove = [...before].filter((id) => !next.includes(id));
    if (toAdd.length === 0 && toRemove.length === 0) return { supervisorIds: next };

    await db.$transaction([
      ...(toRemove.length > 0 ? [db.employeeSupervisor.deleteMany({ where: { employeeId, supervisorId: { in: toRemove } } })] : []),
      ...(toAdd.length > 0
        ? [db.employeeSupervisor.createMany({ data: toAdd.map((supervisorId) => ({ employeeId, supervisorId, createdById: actorId || null })) })]
        : []),
    ]);

    const names = new Map(
      (await db.employee.findMany({ where: { id: { in: [...before, ...next] } }, select: { id: true, user: { select: { name: true } } } }))
        .map((e) => [e.id, e.user?.name ?? e.id]),
    );
    const list = (ids: Iterable<string>) => [...ids].map((id) => names.get(id) ?? id).sort().join(", ") || "—";
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: employeeId,
      action: "EMPLOYEE_UPDATED",
      changes: { fields: [{ field: "Additional supervisors", before: list(before), after: list(next) }] },
    });

    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${employeeId}`);
    return { supervisorIds: next };
  }
);

// ─────────────────────────────────────────────────────────────────────────────

export const getEmployeeAuditLogs = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, { employeeId }: { employeeId: string }) => {
    // In the company, and at the admin's sites: this filtered on the id alone.
    await assertRecordInReach(actor, employeeId);
    const logs = await db.auditLog.findMany({
      where: { entityType: "EMPLOYEE", entityId: employeeId, action: { in: ["EMPLOYEE_CREATED", "EMPLOYEE_UPDATED"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        actor: { select: { user: { select: { name: true } } } },
      },
    });
    return logs.map((log) => {
      const changes = log.changes as Record<string, unknown> | null;
      let fields: Array<{ field: string; before: string; after: string }>;
      if (log.action === "EMPLOYEE_CREATED") {
        const after = (changes?.after ?? {}) as Record<string, string>;
        fields = [
          { field: "Employee Code", before: "—", after: after.employeeCode ?? "—" },
          { field: "Role", before: "—", after: after.role ?? "—" },
        ];
      } else {
        fields = (changes as { fields?: Array<{ field: string; before: string; after: string }> } | null)?.fields ?? [];
      }
      return {
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        actorName: log.actor?.user.name ?? "System",
        action: log.action,
        fields,
      };
    });
  }
);

export const getEmployeeLeaveLog = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, { employeeId }: { employeeId: string }) => {
    await assertRecordInReach(actor, employeeId);
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
    const site = await db.site.create({
      data: { ...parsed, address: parsed.address?.trim() || null, tenantId },
    });
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
    if (!tenantId) throw new Error("Tenant context required");
    const { siteId, isActive, address, ...rest } = updateSiteSchema.parse(input);
    // Found inside this company first: an id from another one answers the
    // same "not found" as an id that does not exist.
    const own = await db.site.findFirst({ where: { id: siteId, tenantId }, select: { id: true } });
    if (!own) throw new Error("NOT_FOUND");
    const updated = await db.site.update({
      where: { id: own.id },
      data: {
        ...rest,
        // An emptied address clears it. It used to be sent as undefined,
        // which Prisma skips, so the old address could never be removed.
        ...(address !== undefined && { address: address.trim() || null }),
        ...(isActive !== undefined && { isActive }),
      },
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

/** Every site id has to be one of this company's sites. */
async function assertOwnSites(tenantId: string, siteIds: string[]) {
  const unique = [...new Set(siteIds)];
  const found = await db.site.count({ where: { tenantId, id: { in: unique } } });
  if (found !== unique.length) throw new Error("NOT_FOUND");
}

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
    await assertOwnSites(tenantId, siteIds);
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
    if (!tenantId) throw new Error("Tenant context required");
    const { departmentId, isActive, siteIds, name } = updateDepartmentSchema.parse(input);
    const own = await db.department.findFirst({ where: { id: departmentId, tenantId }, select: { id: true } });
    if (!own) throw new Error("NOT_FOUND");
    await assertOwnSites(tenantId, siteIds);
    await db.$transaction(async (tx) => {
      await tx.department.update({
        where: { id: own.id },
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

/** A pay code picked for a leave type has to be this company's. */
async function assertOwnPayCode(tenantId: string, payCodeId: string | null | undefined) {
  if (!payCodeId) return;
  const found = await db.payCode.findFirst({ where: { id: payCodeId, tenantId }, select: { id: true } });
  if (!found) throw new Error("NOT_FOUND");
}

export const getLeaveTypesAdmin = withRBAC(
  "RULES_MANAGE",
  async ({ tenantId }, _input: void) => {
    if (!tenantId) return [];
    return db.leaveType.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  }
);

export const createLeaveType = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: LeaveTypeInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = leaveTypeSchema.parse(input);
    await assertOwnPayCode(tenantId, parsed.payCodeId);
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
    if (!tenantId) throw new Error("Tenant context required");
    const { leaveTypeId, isActive, ...rest } = updateLeaveTypeSchema.parse(input);
    const own = await db.leaveType.findFirst({ where: { id: leaveTypeId, tenantId }, select: { id: true } });
    if (!own) throw new Error("NOT_FOUND");
    await assertOwnPayCode(tenantId, rest.payCodeId);
    const updated = await db.leaveType.update({
      where: { id: own.id },
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
    // With no company it used to drop the filter and return every company's.
    if (!tenantId) return [];
    return db.ruleSet.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      include: { _count: { select: { employees: true } } },
    });
  }
);

/** One rule set, for its editor page. Only the caller's company's. */
export const getRuleSet = withRBAC(
  "RULES_MANAGE",
  async ({ tenantId }, input: { ruleSetId: string }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const rs = await db.ruleSet.findFirst({
      where: { id: input.ruleSetId, tenantId },
      include: { _count: { select: { employees: true } } },
    });
    if (!rs) throw new Error("NOT_FOUND");
    return rs;
  }
);

/** Every pay code a rule set points at has to be this company's. */
async function assertRuleSetPayCodes(
  tenantId: string,
  rs: {
    defaultPayCodeId?: string | null;
    autoPayPayCodeId?: string | null;
    autoPayOverflowPayCodeId?: string | null;
    flsaAdjustmentPayCodeId?: string | null;
    flsaAltPayCodeId?: string | null;
    mealPremiumRows?: { payCodeId?: string | null }[] | null;
  },
) {
  const ids = [
    rs.defaultPayCodeId,
    rs.autoPayPayCodeId,
    rs.autoPayOverflowPayCodeId,
    rs.flsaAdjustmentPayCodeId,
    rs.flsaAltPayCodeId,
    ...(rs.mealPremiumRows ?? []).map((r) => r.payCodeId),
  ].filter((id): id is string => !!id);
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const found = await db.payCode.count({ where: { id: { in: unique }, tenantId } });
  if (found !== unique.length) throw new Error("NOT_FOUND");
}

export const createRuleSet = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: RuleSetInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { payPeriodAnchorDate: anchorStr, otCycleAnchorDate: otAnchorStr, ...parsed } = ruleSetSchema.parse(input);
    await assertRuleSetPayCodes(tenantId, parsed);
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
    revalidatePath("/admin/rules-setup");
    return rs;
  }
);

export const updateRuleSet = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: UpdateRuleSetInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { ruleSetId, payPeriodAnchorDate: anchorStr, otCycleAnchorDate: otAnchorStr, ...rest } = updateRuleSetSchema.parse(input);
    // Found inside the caller's company first; it used to update by id alone.
    const own = await db.ruleSet.findFirst({ where: { id: ruleSetId, tenantId }, select: { id: true } });
    if (!own) throw new Error("NOT_FOUND");
    await assertRuleSetPayCodes(tenantId, rest);
    const payPeriodAnchorDate = anchorStr ? new Date(anchorStr + "T12:00:00") : null;
    const otCycleAnchorDate = otAnchorStr ? new Date(otAnchorStr + "T12:00:00") : null;
    const updated = await db.ruleSet.update({ where: { id: own.id }, data: { ...rest, payPeriodAnchorDate, otCycleAnchorDate } });

    // If this save configured (or changed) the pay schedule, immediately generate
    // current + future periods so findOpenPayPeriod never falls back to the
    // tenant-level period and creates an orphaned timesheet.
    if (updated.payFrequency && updated.payPeriodAnchorDate) {
      await generatePeriodsForRuleSet(ruleSetId, tenantId);
    }

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "RULE_SET",
      entityId: ruleSetId,
      action: "RULE_SET_UPDATED",
    });
    revalidatePath("/admin/rules-setup");
    return updated;
  }
);

export const deleteRuleSet = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: { ruleSetId: string }) => {
    if (!tenantId) throw new Error("Tenant context required");
    // Found inside the caller's company; it used to delete by id alone.
    const rs = await db.ruleSet.findFirst({
      where: { id: input.ruleSetId, tenantId },
      include: { _count: { select: { employees: true } } },
    });
    if (!rs) throw new Error("NOT_FOUND");
    if (rs.isDefault) throw new Error("The default rule set cannot be deleted.");
    const people = rs._count.employees;
    if (people > 0)
      throw new Error(
        `${people.toLocaleString()} ${people === 1 ? "employee is" : "employees are"} on this rule set. Move them to another one first, or set it to inactive.`
      );
    await db.ruleSet.deleteMany({ where: { id: rs.id, tenantId } });
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "RULE_SET",
      entityId: input.ruleSetId,
      action: "RULE_SET_DELETED",
      changes: { before: { name: rs.name } },
    });
    revalidatePath("/admin/rules-setup");
  }
);

// ─── Employee Leave Balances ───────────────────────────────────────────────────

/** All active leave types merged with this employee's balances for a given year. */
export const getEmployeeLeaveBalances = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, input: { employeeId: string; year?: number }) => {
    const { tenantId } = actor;
    await assertRecordInReach(actor, input.employeeId);
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
  async (actor, input: AdjustLeaveBalanceInput) => {
    const { employeeId: actorId, tenantId } = actor;
    const { employeeId, leaveTypeId, year, mode, enteredMinutes, note } =
      adjustLeaveBalanceSchema.parse(input);
    await assertBalanceChangeAllowed(actor, employeeId, leaveTypeId);

    const existing = await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      update: {},
      create: { employeeId, leaveTypeId, accrualYear: year, balanceSeconds: 0, usedSeconds: 0 },
    });

    // From the exact balance (lib/leave-time), not the minutes the page shows:
    // adding 2 hours to 6.16 is 8.16, where adding to the 6h 10m shown was 8.17.
    const entered = enteredMinutes * 60;
    const newBalanceSeconds =
      mode === "ADD" ? existing.balanceSeconds + entered :
      mode === "SUBTRACT" ? existing.balanceSeconds - entered :
      entered;
    const delta = newBalanceSeconds - existing.balanceSeconds;

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
        data: { balanceSeconds: newBalanceSeconds },
      }),
      db.leaveAccrualLedger.create({
        data: {
          employeeId,
          leaveTypeId,
          action: "ADJUSTMENT",
          deltaSeconds: delta,
          balanceAfterSeconds: newBalanceSeconds,
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
        after: { balanceMinutes: secondsToMinutes(newBalanceSeconds), note: ledgerNote },
      },
    });

    revalidatePath(`/admin/employees/${employeeId}`);
  }
);

/** Post a delta ADJUSTMENT entry to correct a gap between expected and actual accrual. */
export const postAccrualCorrection = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, input: unknown) => {
    const { employeeId: actorId, tenantId } = actor;
    const { employeeId, leaveTypeId, year, deltaMinutes, note } = postAccrualCorrectionSchema.parse(input);
    await assertBalanceChangeAllowed(actor, employeeId, leaveTypeId);

    if (deltaMinutes === 0) return { success: true as const };

    const existing = await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      update: {},
      create: { employeeId, leaveTypeId, accrualYear: year, balanceSeconds: 0, usedSeconds: 0 },
    });

    const deltaSeconds = deltaMinutes * 60;
    const newBalance = existing.balanceSeconds + deltaSeconds;

    await db.$transaction([
      db.leaveBalance.update({
        where: { id: existing.id },
        data: { balanceSeconds: newBalance },
      }),
      db.leaveAccrualLedger.create({
        data: {
          employeeId,
          leaveTypeId,
          action: "ACCRUAL",
          deltaSeconds,
          balanceAfterSeconds: newBalance,
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
        after:  { balanceMinutes: secondsToMinutes(newBalance), note: `Accrual correction: ${note}` },
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
    actor,
    input: { employeeId: string; leaveTypeId: string; year: number },
  ) => {
    const { employeeId: actorId, tenantId } = actor;
    const { employeeId, leaveTypeId, year } = z
      .object({ employeeId: z.string(), leaveTypeId: z.string(), year: z.number().int() })
      .parse(input);
    await assertBalanceChangeAllowed(actor, employeeId, leaveTypeId);

    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd   = new Date(`${year + 1}-01-01T00:00:00Z`);

    const [existing, accrualSum] = await Promise.all([
      db.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      }),
      db.leaveAccrualLedger.aggregate({
        where: { employeeId, leaveTypeId, action: { in: ["ACCRUAL", "EARNED_ADJUSTMENT"] }, payPeriodEnd: { gte: yearStart, lt: yearEnd } },
        _sum: { deltaSeconds: true },
      }),
    ]);

    if (!existing) throw new Error("No balance record found for this leave type and year.");

    // balanceMinutes is the remaining balance (accrued minus used), so subtract usedMinutes
    // so the employee's total on the dashboard reconstructs correctly as accruedMinutes.
    const newBalance = (accrualSum._sum.deltaSeconds ?? 0) - existing.usedSeconds;
    const delta = newBalance - existing.balanceSeconds;

    await db.$transaction([
      db.leaveBalance.update({
        where: { id: existing.id },
        data: { balanceSeconds: newBalance },
      }),
      db.leaveAccrualLedger.create({
        data: {
          employeeId,
          leaveTypeId,
          action: "ADJUSTMENT",
          deltaSeconds: delta,
          balanceAfterSeconds: newBalance,
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
        after: { balanceMinutes: secondsToMinutes(newBalance) },
      },
    });

    revalidatePath(`/admin/employees/${employeeId}`);
  }
);

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditRange = "any" | "today" | "7" | "30";

/**
 * One page of the company's audit log, newest first, with the filters the
 * Audit Log screen offers: a search over the action and the record id, the
 * record type, who did it ("system" for entries with no person), and how far
 * back. Each row carries the link to its record where the app has a page
 * for one, worked out here so the screen never guesses a route.
 */
export const getAuditLogs = withRBAC(
  "AUDIT_VIEW",
  async (
    { tenantId },
    input: { page?: number; entityType?: string; q?: string; actor?: string; range?: AuditRange; tz?: string } = {}
  ) => {
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const take = 50;
    const skip = (page - 1) * take;
    const tenantFilter = tenantId ? { tenantId } : {};

    const entityType = ENTITY_TYPES.includes(input.entityType as never) ? (input.entityType as AuditEntityType) : undefined;
    const q = (input.q ?? "").trim().slice(0, 100);
    const actor = (input.actor ?? "").trim();
    const range: AuditRange = ["today", "7", "30"].includes(input.range ?? "") ? (input.range as AuditRange) : "any";

    // "Today" is the viewer's own day. A timezone the runtime does not know
    // falls back to the server's rather than failing the page.
    let since: Date | undefined;
    if (range !== "any") {
      let tz = "America/New_York";
      try {
        if (input.tz) {
          new Intl.DateTimeFormat("en-US", { timeZone: input.tz });
          tz = input.tz;
        }
      } catch {}
      const todayStart = startOfDayInTz(new Date(), tz);
      since = range === "today" ? todayStart : new Date(todayStart.getTime() - (Number(range) - 1) * 86400000);
    }

    const where: Prisma.AuditLogWhereInput = {
      ...tenantFilter,
      ...(entityType ? { entityType } : {}),
      ...(actor === "system" ? { actorId: null } : actor ? { actorId: actor } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(q
        ? {
            OR: [
              { action: { contains: q, mode: "insensitive" } },
              { entityId: { contains: q, mode: "insensitive" } },
              ...(actionsMatching(q).length ? [{ action: { in: actionsMatching(q) } }] : []),
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          changes: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          actorId: true,
          actor: { select: { user: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      db.auditLog.count({ where }),
    ]);

    // A timesheet opens on the timecard screen, which is addressed by the
    // employee and the period, so those come from the timesheet itself.
    const timesheetIds = rows.filter((r) => r.entityType === "TIMESHEET").map((r) => r.entityId);
    const timesheets = timesheetIds.length
      ? await db.timesheet.findMany({
          where: { id: { in: timesheetIds }, ...(tenantId ? { employee: { tenantId } } : {}) },
          select: { id: true, employeeId: true, payPeriodId: true },
        })
      : [];
    const sheet = new Map(timesheets.map((t) => [t.id, t]));

    const hrefOf = (r: (typeof rows)[number]): string | null => {
      const id = encodeURIComponent(r.entityId);
      switch (r.entityType) {
        case "EMPLOYEE":
          return `/admin/employees/${id}`;
        case "PAY_PERIOD":
          // Company settings changes are filed here with the company as the record.
          // The gate alert switch is one of them, and lives on Live Attendance.
          if (r.action === "SETTINGS_UPDATE") return isGateAlertSwitch(r.changes) ? "/supervisor/on-site" : "/admin/settings";
          return `/payroll/pay-periods?id=${id}`;
        case "RULE_SET":
          return r.action === "RULE_SET_DELETED" ? null : `/admin/rules-setup/rule-sets/${id}`;
        case "PTO_POLICY":
          return r.action === "PTO_POLICY_DELETED" ? null : `/admin/rules-setup/leave-policies/${id}`;
        case "TIMESHEET": {
          const t = sheet.get(r.entityId);
          return t ? `/payroll/timecards?employeeId=${encodeURIComponent(t.employeeId)}&periodId=${encodeURIComponent(t.payPeriodId)}` : null;
        }
        case "ADP_SYNC":
          return "/admin/adp";
        default:
          return null;
      }
    };

    const logs = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      changes: r.changes,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
      actorId: r.actorId,
      actorName: r.actor?.user?.name ?? null,
      href: hrefOf(r),
    }));

    return { logs, total, page, pages: Math.max(1, Math.ceil(total / take)) };
  }
);

/**
 * Everybody who appears in the company's audit log, most entries first, for
 * the Actor filter. Entries with no person are offered separately as System.
 */
export const getAuditActors = withRBAC("AUDIT_VIEW", async ({ tenantId }, _input: void) => {
  const grouped = await db.auditLog.groupBy({
    by: ["actorId"],
    where: { ...(tenantId ? { tenantId } : {}), actorId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { actorId: "desc" } },
    take: 200,
  });
  const ids = grouped.map((g) => g.actorId).filter((id): id is string => !!id);
  const people = ids.length
    ? await db.employee.findMany({
        where: { id: { in: ids }, ...(tenantId ? { tenantId } : {}) },
        select: { id: true, user: { select: { name: true } } },
      })
    : [];
  const name = new Map(people.map((p) => [p.id, p.user?.name ?? null]));
  return ids
    .filter((id) => name.has(id))
    .map((id) => ({ id, name: name.get(id) || "Unnamed employee" }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

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
  async (actor, input: { rows: CsvEmployeeRow[] }) => {
    const { employeeId: actorId, tenantId } = actor;
    if (!tenantId) throw new Error("Tenant context required");
    // 1. Validate every row with Zod
    const rowErrors: { row: number; message: string }[] = [];
    const parsed: CsvEmployeeRow[] = [];

    for (let i = 0; i < input.rows.length; i++) {
      const result = csvEmployeeRowSchema.safeParse(input.rows[i]);
      if (!result.success) {
        const msgs = result.error.issues.map((iss) => zodMessage({ issues: [iss] } as ZodError)).join("; ");
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
      db.customRole.findMany({ where: { tenantId }, select: { id: true, name: true, rank: true, liveAttendanceOnly: true } }),
    ]);
    // The same rules as one at a time: only roles below the importer's own,
    // and a role limited to Live Attendance only from a System Admin.
    const me = await currentIdentity();
    if (!me) throw new Error("FORBIDDEN");
    const roleRankById = new Map(customRoles.map((cr) => [cr.id, cr.rank]));
    const limitedRoleIds = new Set(customRoles.filter((cr) => cr.liveAttendanceOnly).map((cr) => cr.id));
    const givesLimited = givesLiveAttendanceRoles(me);
    const tooSenior = (rank: number) => !me.isSuperAdmin && rank >= me.rank;

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

    // Who already holds an email or Badge ID in the file (both are unique across
    // every company) or an employee code (unique in this one). Checked here so
    // each clash shows on its row, naming the person who has it; the database
    // refusal it used to wait for named the row's own person instead.
    // Both emails of every row, against both of everyone's (ignoring capitals).
    const fileEmails = parsed.flatMap((r) => [r.email?.trim(), r.workEmail?.trim()]).filter((e): e is string => !!e);
    const fileBadges = parsed.map((r) => r.wmsId?.trim()).filter((w): w is string => !!w);
    const [emailOwners, badgeHolders] = await Promise.all([
      emailHolders(fileEmails),
      db.employee.findMany({
        where: { wmsId: { in: fileBadges } },
        select: { wmsId: true, tenantId: true, employeeCode: true, user: { select: { name: true } } },
      }),
    ]);
    // Somebody in another company is not named.
    const holder = (tenant: string | null | undefined, name: string | null | undefined, code: string | null | undefined) =>
      tenant === tenantId ? `${name ?? "another employee"}${code ? ` (employee code ${code})` : ""}` : "an account in another company";
    const emailHolder = new Map([...emailOwners].map(([address, u]) => [address, holder(u.tenantId, u.name, u.employeeCode)]));
    const badgeHolder = new Map(badgeHolders.map((e) => [e.wmsId!, holder(e.tenantId, e.user.name, e.employeeCode)]));
    const codeHolderName = new Map(
      (await db.employee.findMany({
        where: { tenantId, employeeCode: { in: parsed.map((r) => r.employeeCode) } },
        select: { employeeCode: true, user: { select: { name: true } } },
      })).map((e) => [e.employeeCode, e.user.name ?? "another employee"]),
    );

    for (let i = 0; i < parsed.length; i++) {
      const r = parsed[i];
      const errors: string[] = [];

      const siteId = siteMap.get(r.site.toLowerCase());
      if (!siteId) errors.push(`Site "${r.site}" not found`);
      else {
        const reach = await siteInReach(actor, siteId);
        if (!reach.ok) errors.push(reach.message);
      }

      const departmentId = deptMap.get(r.department.toLowerCase());
      if (!departmentId) errors.push(`Department "${r.department}" not found`);

      const ruleSetId = ruleSetMap.get(r.ruleSet.toLowerCase());
      if (!ruleSetId) errors.push(`Rule set "${r.ruleSet}" not found`);

      if (r.email && r.workEmail && r.email.toLowerCase() === r.workEmail.toLowerCase()) {
        errors.push(`The work email and the personal email are both "${r.email}". Keep it in one of them`);
      } else {
        for (const address of [r.workEmail, r.email]) {
          if (!address) continue;
          if (seenEmails.has(address.toLowerCase())) {
            errors.push(`The email "${address}" is on another row of this file too`);
          }
          seenEmails.add(address.toLowerCase());
          const has = emailHolder.get(address.trim().toLowerCase());
          if (has) errors.push(`The email "${address}" is already used by ${has}`);
        }
      }

      if (seenCodes.has(r.employeeCode)) {
        errors.push(`The employee code "${r.employeeCode}" is on another row of this file too`);
      }
      seenCodes.add(r.employeeCode);
      const codeHas = codeHolderName.get(r.employeeCode);
      if (codeHas) errors.push(`The employee code "${r.employeeCode}" already belongs to ${codeHas}`);

      if (r.wmsId?.trim()) {
        const badgeHas = badgeHolder.get(r.wmsId.trim());
        if (badgeHas) errors.push(`The Badge ID "${r.wmsId}" already belongs to ${badgeHas}`);
      }

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

      const givenRank = resolvedCustomRoleId
        ? roleRankById.get(resolvedCustomRoleId) ?? 0
        : isValidRole(resolvedRole) ? ROLE_RANK[resolvedRole] : 0;
      if (resolvedRole === "SUPER_ADMIN" || tooSenior(givenRank)) {
        errors.push("You can only give a role below your own");
      }
      if (resolvedCustomRoleId && limitedRoleIds.has(resolvedCustomRoleId) && !givesLimited) {
        errors.push("Only a System Admin can give a role limited to Live Attendance");
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
                ...(r.email && { email: cleanEmail(r.email, "personal") }),
                ...(r.workEmail && { workEmail: cleanEmail(r.workEmail, "work") }),
              },
            });
          } catch (createErr: unknown) {
            const msg = createErr instanceof Error ? createErr.message : String(createErr);
            // The unique index, or the database's one address, one person rule
            if ((msg.includes("Unique constraint") || msg.includes("already used by another person")) && (r.email || r.workEmail)) {
              throw new Error(`An email of ${r.name} (${[r.workEmail, r.email].filter(Boolean).join(", ")}) is already used by another account. Nothing was imported.`);
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
              webPunchEnabled: webPunchByDefault(r.resolvedCustomRoleId ? "EMPLOYEE" : (r.resolvedRole as Role)),
              siteId: r.siteId,
              departmentId: r.departmentId,
              ruleSetId: r.ruleSetId,
              hireDate: calendarDay(r.hireDate),
              supervisorId: null,
              // "CL" asks for the next client badge (client-badge.ts).
              wmsId: asksForClientBadge(r.wmsId) ? await issueClientBadge(tx) : r.wmsId ?? null,
              payType: r.payType ?? null,
              payRate: r.payRate ?? null,
              ...(r.payRate
                ? { payRates: { create: { effectiveDate: new Date(`${r.hireDate}T00:00:00.000Z`), rate1: r.payRate } } }
                : {}),
            },
          });
          } catch (empErr: unknown) {
            const msg = empErr instanceof Error ? empErr.message : String(empErr);
            if (msg.includes("Unique constraint") && msg.includes("wmsId")) {
              throw new Error(`The Badge ID "${r.wmsId}" (for ${r.name}) already belongs to another employee. Nothing was imported.`);
            }
            if (msg.includes("Unique constraint") && msg.includes("employeeCode")) {
              throw new Error(`The employee code "${r.employeeCode}" (for ${r.name}) already belongs to another employee. Nothing was imported.`);
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

      // Each person's role by name, so an import that hands out a custom role
      // (such as Loss Prevention) can be traced like a one-by-one create.
      const roleIds = [...new Set(resolved.map((r) => r.resolvedCustomRoleId).filter((id): id is string => !!id))];
      const roleNames = new Map(
        (await db.customRole.findMany({ where: { id: { in: roleIds }, tenantId }, select: { id: true, name: true } }))
          .map((cr) => [cr.id, cr.name]),
      );
      await writeAuditLog({
        tenantId,
        actorId,
        entityType: "EMPLOYEE",
        entityId: "BULK_IMPORT",
        action: "EMPLOYEES_BULK_CREATED",
        changes: {
          after: {
            count: created,
            codes: resolved.map((r) => r.employeeCode),
            roles: resolved.map((r) => ({
              code: r.employeeCode,
              role: (r.resolvedCustomRoleId && roleNames.get(r.resolvedCustomRoleId)) || r.resolvedRole,
            })),
          },
        },
      });

      revalidatePath("/admin/employees");
      return { created, errors: [] };
    } catch (err) {
      // Our own sentences pass; a database error is logged with a reference, not shown.
      return { created: 0, errors: [{ row: 0, message: publicError(err).error }] };
    }
  }
);

// ─── Manual accrual entry (replaces adjust-balance + clear-manual-adj) ────────

export const postManualAccrualEntry = withRBAC(
  "EMPLOYEE_MANAGE",
  async (actor, input: unknown) => {
    const { employeeId: actorId, tenantId } = actor;
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
    await assertBalanceChangeAllowed(actor, employeeId, leaveTypeId);

    if (accrualMinutes === 0 && adjustEarnMinutes === 0 && adjustMinutes === 0) {
      return { success: false as const, error: "Enter a non-zero value for Accrual Hours, Adjust Earn Hours, or Adjust Hours." };
    }

    const existing = await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_accrualYear: { employeeId, leaveTypeId, accrualYear: year } },
      update: {},
      create: { employeeId, leaveTypeId, accrualYear: year, balanceSeconds: 0, usedSeconds: 0 },
    });

    // Entered in hours and minutes; kept in seconds on the exact balance (lib/leave-time).
    const accrualSeconds = accrualMinutes * 60, adjustEarnSeconds = adjustEarnMinutes * 60, adjustSeconds = adjustMinutes * 60;
    const effectiveDateObj = new Date(`${effectiveDate}T00:00:00Z`);
    const newBalance = existing.balanceSeconds + accrualSeconds + adjustEarnSeconds + adjustSeconds;

    const ledgerEntries: {
      employeeId: string; leaveTypeId: string; action: "ACCRUAL" | "EARNED_ADJUSTMENT" | "ADJUSTMENT";
      deltaSeconds: number; balanceAfterSeconds: number; payPeriodEnd: Date; note: string; createdById: string | null;
    }[] = [];
    let running = existing.balanceSeconds;

    if (accrualMinutes !== 0) {
      running += accrualSeconds;
      ledgerEntries.push({ employeeId, leaveTypeId, action: "ACCRUAL", deltaSeconds: accrualSeconds, balanceAfterSeconds: running, payPeriodEnd: effectiveDateObj, note, createdById: actorId ?? null });
    }
    if (adjustEarnMinutes !== 0) {
      running += adjustEarnSeconds;
      ledgerEntries.push({ employeeId, leaveTypeId, action: "EARNED_ADJUSTMENT", deltaSeconds: adjustEarnSeconds, balanceAfterSeconds: running, payPeriodEnd: effectiveDateObj, note, createdById: actorId ?? null });
    }
    if (adjustMinutes !== 0) {
      running += adjustSeconds;
      ledgerEntries.push({ employeeId, leaveTypeId, action: "ADJUSTMENT", deltaSeconds: adjustSeconds, balanceAfterSeconds: running, payPeriodEnd: effectiveDateObj, note, createdById: actorId ?? null });
    }

    await db.$transaction([
      db.leaveBalance.update({ where: { id: existing.id }, data: { balanceSeconds: newBalance } }),
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
        after:  { balanceMinutes: secondsToMinutes(newBalance), note, accrualMinutes, adjustEarnMinutes, adjustMinutes },
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
  createdByName?: string | null;
};

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
        select: { balanceAfterSeconds: true },
      }),
      db.leaveAccrualLedger.findMany({
        where: { employeeId, leaveTypeId, createdAt: { gte: yearStart, lt: yearEnd }, action: { not: "EOD_SNAPSHOT" } },
        orderBy: { createdAt: "asc" },
        select: { id: true, action: true, deltaSeconds: true, balanceAfterSeconds: true, createdAt: true, note: true, createdById: true },
      }),
      db.leaveRequest.findMany({
        where: { employeeId, leaveTypeId, status: { in: ["APPROVED", "PENDING"] }, startDate: { gte: yearStart, lt: yearEnd } },
        orderBy: { startDate: "asc" },
        select: { id: true, startDate: true, durationSeconds: true, status: true },
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

    // Minutes with the fraction kept, from the seconds columns, so the ledger
    // shows a 6.16 h posting as 6.16 (lib/leave-time).
    const openingBalance = (openingEntry?.balanceAfterSeconds ?? 0) / 60;

    // Batch-fetch names for users who appear in these ledger entries
    const creatorIds = [...new Set(yearEntries.map((e) => e.createdById).filter(Boolean))] as string[];
    const creatorUsers = creatorIds.length > 0
      ? await db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
      : [];
    const creatorNameById = new Map(creatorUsers.map((u) => [u.id, u.name]));

    // Build historical entries
    const entries: LedgerDetailEntry[] = yearEntries.map((e) => ({
      id: e.id,
      date: e.createdAt.toISOString().slice(0, 10),
      type: e.action,
      label: ledgerLabel(e.action),
      deltaMinutes: e.deltaSeconds / 60,
      runningBalance: e.balanceAfterSeconds / 60,
      isFuture: false,
      note: e.note,
      createdByName: e.createdById ? (creatorNameById.get(e.createdById) ?? null) : null,
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

        // For PER_PAY_PERIOD, project forward at bi-weekly intervals from the last
        // actual accrual posting (or cycleAnchor if no postings yet this year).
        const postingDates = policy.posting1Freq === "PER_PAY_PERIOD"
          ? (() => {
              const lastAccrual = [...yearEntries].reverse().find(e => e.action === "ACCRUAL");
              const anchor = lastAccrual ? lastAccrual.createdAt : cycleAnchor;
              return enumeratePostingDates("BI_WEEKLY", anchor, basisDate, forecastFrom, forecastTo);
            })()
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
          ...futureRequests.map((r) => ({ kind: "leave" as const, date: r.startDate, id: r.id, durationMinutes: r.durationSeconds / 60, status: r.status })),
          ...forecastItems.map((f) => ({ kind: "forecast" as const, date: f.date, deltaMinutes: f.deltaMinutes })),
        ].sort((a, b) => a.date.getTime() - b.date.getTime());

        let runningBal = yearEntries.length > 0
          ? yearEntries[yearEntries.length - 1].balanceAfterSeconds / 60
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
      let runningBal = yearEntries.length > 0 ? yearEntries[yearEntries.length - 1].balanceAfterSeconds / 60 : openingBalance;
      for (const r of futureRequests) {
        runningBal -= r.durationSeconds / 60;
        entries.push({
          id: r.id,
          date: r.startDate.toISOString().slice(0, 10),
          type: "LEAVE_REQUEST",
          label: r.status === "APPROVED" ? "Approved Leave" : "Pending Leave",
          deltaMinutes: -r.durationSeconds / 60,
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
