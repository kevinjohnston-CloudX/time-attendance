import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { localDateString } from "@/lib/presence/on-site.service";
import { SIGN_IN_ONLY_RULE_SET, VISITOR_DEPARTMENT } from "@/lib/sign-in-only";
import { CLIENT_BADGE_PREFIX, NOT_VISITOR, issueClientBadge, previewClientBadge } from "@/lib/utils/client-badge";
import {
  lastDayOf,
  passStanding,
  renewalStart,
  type PassStanding,
  type VisitorKind,
  type VisitorTerm,
} from "./visitor-pass";

/**
 * Adding and renewing visitors from Live Attendance (visitor-pass.ts).
 *
 * <p>A visitor is made exactly as New Employee makes one (admin.actions.ts
 * createEmployee): the company's Visitor role (a custom role with no
 * permissions), the Visitors department, the UNASSIGNED rule set, the next
 * client badge as both Badge ID and employee code, and no email, supervisor,
 * schedule or pay. Then a pass says for how long, and where.
 *
 * <p>Callers check the permission (VISITOR_MANAGE) and that the viewer may see
 * the building. Everything here is scoped to the company in the where.
 */

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);

/** What a company needs before it can have visitors, or why it cannot yet. */
export async function visitorSetup(tenantId: string): Promise<
  { ok: true; roleId: string; departmentId: string; ruleSetId: string } | { ok: false; missing: string }
> {
  const [roles, dept, ruleSet] = await Promise.all([
    // The Visitor role: one the company made, with no permissions at all
    // (sign-in-only.ts isVisitorRole). The one named Visitor, if there are several.
    db.customRole.findMany({
      where: { tenantId, isSystem: false, permissions: { none: {} } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    db.department.findFirst({ where: { tenantId, name: VISITOR_DEPARTMENT, isActive: true }, select: { id: true } }),
    db.ruleSet.findFirst({ where: { tenantId, name: SIGN_IN_ONLY_RULE_SET }, select: { id: true } }),
  ]);
  const role = roles.find((r) => r.name.trim().toLowerCase() === "visitor") ?? roles[0];
  if (!role) return { ok: false, missing: "a Visitor role with no permissions (Roles)" };
  if (!dept) return { ok: false, missing: `a department named ${VISITOR_DEPARTMENT}` };
  if (!ruleSet) return { ok: false, missing: `a rule set named ${SIGN_IN_ONLY_RULE_SET} (Rules Setup)` };
  return { ok: true, roleId: role.id, departmentId: dept.id, ruleSetId: ruleSet.id };
}

/** The badge the next visitor will get. Only a preview: it is taken at the save. */
export function nextVisitorBadge(): Promise<string> {
  return previewClientBadge(db);
}

export interface VisitorMatch {
  id: string;
  name: string;
  badge: string;
  company: string | null;
  siteId: string | null;
  siteName: string | null;
  /** No pass: a badge from before passes, which works everywhere with no end. */
  standing: PassStanding | "NO_PASS";
  kind: VisitorKind | null;
  validUntil: string | null;
  isActive: boolean;
}

/** A building's calendar day today. */
async function siteToday(tenantId: string, siteId: string): Promise<{ today: string; name: string } | null> {
  const site = await db.site.findFirst({ where: { id: siteId, tenantId }, select: { timezone: true, name: true } });
  return site ? { today: localDateString(new Date(), site.timezone), name: site.name } : null;
}

/**
 * Visitors of the company whose name or badge holds the text, for "has this
 * person been here before?". Any building: the answer is shown with where
 * their badge works, and renewing moves it here.
 */
export async function findVisitors(tenantId: string, siteId: string, q: string): Promise<VisitorMatch[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const here = await siteToday(tenantId, siteId);
  if (!here) return [];
  const rows = await db.employee.findMany({
    where: {
      tenantId,
      wmsId: { startsWith: CLIENT_BADGE_PREFIX },
      OR: [{ user: { name: { contains: text, mode: "insensitive" } } }, { wmsId: { contains: text, mode: "insensitive" } }],
    },
    select: {
      id: true,
      wmsId: true,
      isActive: true,
      user: { select: { name: true } },
      visitorPass: { select: { siteId: true, kind: true, company: true, validFrom: true, validUntil: true, endedAt: true, site: { select: { name: true } } } },
      site: { select: { id: true, name: true } },
    },
    orderBy: { user: { name: "asc" } },
    take: 6,
  });
  return rows.map((r) => {
    const p = r.visitorPass;
    return {
      id: r.id,
      name: r.user.name ?? r.wmsId ?? "",
      badge: r.wmsId ?? "",
      company: p?.company ?? null,
      siteId: p?.siteId ?? r.site?.id ?? null,
      siteName: p?.site.name ?? r.site?.name ?? null,
      standing: !r.isActive
        ? "ENDED"
        : p
          ? passStanding({ siteId: p.siteId, validFrom: day(p.validFrom), validUntil: day(p.validUntil), endedAt: p.endedAt }, here.today, null)
          : "NO_PASS",
      kind: (p?.kind as VisitorKind | undefined) ?? null,
      validUntil: p ? day(p.validUntil) : null,
      isActive: r.isActive,
    };
  });
}

export interface HostMatch {
  id: string;
  name: string;
  department: string | null;
  here: boolean;
}

/** Staff a visitor may be visiting: active, not visitors, people at this building first. */
export async function findHosts(tenantId: string, siteId: string, q: string): Promise<HostMatch[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const rows = await db.employee.findMany({
    where: { AND: [{ tenantId, isActive: true, user: { name: { contains: text, mode: "insensitive" } } }, NOT_VISITOR] },
    select: { id: true, siteId: true, user: { select: { name: true } }, department: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
    take: 40,
  });
  return rows
    .map((r) => ({ id: r.id, name: r.user.name ?? "", department: r.department?.name ?? null, here: r.siteId === siteId }))
    .sort((a, b) => Number(b.here) - Number(a.here))
    .slice(0, 8);
}

/** Companies typed on earlier passes, most used first, to suggest as one is typed. */
export async function recentCompanies(tenantId: string): Promise<string[]> {
  const rows = await db.visitorPass.groupBy({
    by: ["company"],
    where: { tenantId, company: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { company: "desc" } },
    take: 40,
  });
  return rows.map((r) => r.company).filter((c): c is string => !!c);
}

export interface NewVisitor {
  siteId: string;
  name: string;
  company: string;
  hostEmployeeId: string | null;
  hostName: string | null;
  kind: VisitorKind;
  term: VisitorTerm;
}

export interface AddedVisitor {
  employeeId: string;
  name: string;
  badge: string;
  siteName: string;
  kind: VisitorKind;
  term: VisitorTerm;
  validFrom: string;
  validUntil: string;
}

/** The person being visited, checked to be staff of this company. */
async function hostOf(tenantId: string, hostEmployeeId: string | null, hostName: string | null) {
  if (!hostEmployeeId) return { hostEmployeeId: null, hostName: hostName?.trim() || null };
  const host = await db.employee.findFirst({
    where: { AND: [{ id: hostEmployeeId, tenantId, isActive: true }, NOT_VISITOR] },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!host) throw new Error("The person being visited was not found. Pick them again.");
  return { hostEmployeeId: host.id, hostName: host.user.name ?? null };
}

/** Adds a visitor at a building, with their pass, and records who did it. */
export async function addVisitor(tenantId: string, actorId: string, input: NewVisitor): Promise<AddedVisitor> {
  const setup = await visitorSetup(tenantId);
  if (!setup.ok) throw new Error(`Visitors need ${setup.missing}, and this company has none. Ask a System Admin to add it.`);
  const here = await siteToday(tenantId, input.siteId);
  if (!here) throw new Error("NOT_FOUND");
  const host = await hostOf(tenantId, input.hostEmployeeId, input.hostName);
  const validFrom = here.today;
  const validUntil = lastDayOf(input.term, validFrom);

  const added = await db.$transaction(async (tx) => {
    const badge = await issueClientBadge(tx);
    const user = await tx.user.create({ data: { name: input.name, email: null, workEmail: null } });
    const employee = await tx.employee.create({
      data: {
        userId: user.id,
        tenantId,
        employeeCode: badge,
        wmsId: badge,
        role: "EMPLOYEE",
        customRoleId: setup.roleId,
        webPunchEnabled: false,
        siteId: input.siteId,
        departmentId: setup.departmentId,
        ruleSetId: setup.ruleSetId,
        hireDate: asDate(validFrom),
        supervisorId: null,
        payType: null,
        payRate: null,
      },
      select: { id: true },
    });
    await tx.visitorPass.create({
      data: {
        tenantId,
        employeeId: employee.id,
        siteId: input.siteId,
        kind: input.kind,
        term: input.term,
        company: input.company,
        hostEmployeeId: host.hostEmployeeId,
        hostName: host.hostName,
        validFrom: asDate(validFrom),
        validUntil: asDate(validUntil),
        createdById: actorId || null,
      },
    });
    return { employeeId: employee.id, badge };
  });

  await writeAuditLog({
    tenantId,
    actorId,
    entityType: "EMPLOYEE",
    entityId: added.employeeId,
    action: "VISITOR_ADDED",
    changes: {
      after: {
        name: input.name,
        clientBadge: added.badge,
        kind: input.kind,
        term: input.term,
        company: input.company,
        visiting: host.hostName,
        building: here.name,
        validFrom,
        validUntil,
      },
    },
  });

  return { ...added, name: input.name, siteName: here.name, kind: input.kind, term: input.term, validFrom, validUntil };
}

/**
 * Renews a visitor's pass at this building: a new length from today if it had
 * run out, or straight after its last day if not, so no day already given is
 * lost. Ends any End access now, and makes the record active again. A pass at
 * another building moves here, which is where the visitor is standing.
 */
export async function renewVisitor(
  tenantId: string,
  actorId: string,
  input: { employeeId: string; siteId: string; kind: VisitorKind; term: VisitorTerm },
): Promise<AddedVisitor> {
  const here = await siteToday(tenantId, input.siteId);
  if (!here) throw new Error("NOT_FOUND");
  const visitor = await db.employee.findFirst({
    where: { id: input.employeeId, tenantId, wmsId: { startsWith: CLIENT_BADGE_PREFIX } },
    select: {
      id: true,
      wmsId: true,
      isActive: true,
      user: { select: { name: true } },
      visitorPass: { select: { siteId: true, kind: true, term: true, validUntil: true, endedAt: true } },
    },
  });
  if (!visitor) throw new Error("NOT_FOUND");
  const before = visitor.visitorPass;
  // A pass that was ended, or is at another building, starts again from today.
  const carryOn = before && !before.endedAt && before.siteId === input.siteId && visitor.isActive;
  const validFrom = carryOn ? renewalStart(day(before.validUntil), here.today) : here.today;
  const validUntil = lastDayOf(input.term, validFrom);
  // The renewal starts the day after the old end when it carries on; the pass
  // itself keeps opening the gate from its first day.
  const passFrom = carryOn ? undefined : asDate(validFrom);

  await db.$transaction([
    db.visitorPass.upsert({
      where: { employeeId: visitor.id },
      create: {
        tenantId,
        employeeId: visitor.id,
        siteId: input.siteId,
        kind: input.kind,
        term: input.term,
        validFrom: asDate(validFrom),
        validUntil: asDate(validUntil),
        createdById: actorId || null,
      },
      update: {
        siteId: input.siteId,
        kind: input.kind,
        term: input.term,
        ...(passFrom && { validFrom: passFrom }),
        validUntil: asDate(validUntil),
        endedAt: null,
        endedById: null,
      },
    }),
    db.employee.updateMany({
      where: { id: visitor.id, tenantId },
      data: { isActive: true, terminatedAt: null, siteId: input.siteId },
    }),
  ]);

  await writeAuditLog({
    tenantId,
    actorId,
    entityType: "EMPLOYEE",
    entityId: visitor.id,
    action: "VISITOR_RENEWED",
    changes: {
      before: before
        ? { kind: before.kind, term: before.term, validUntil: day(before.validUntil), ended: !!before.endedAt, active: visitor.isActive }
        : { pass: "none" },
      after: { kind: input.kind, term: input.term, building: here.name, validUntil },
    },
  });

  return {
    employeeId: visitor.id,
    name: visitor.user.name ?? visitor.wmsId ?? "",
    badge: visitor.wmsId ?? "",
    siteName: here.name,
    kind: input.kind,
    term: input.term,
    validFrom,
    validUntil,
  };
}
