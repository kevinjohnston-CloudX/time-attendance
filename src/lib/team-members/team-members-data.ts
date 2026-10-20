import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { reachesCompany } from "@/lib/rbac/scope";
import { directReportsOf } from "@/lib/get-subordinate-ids";

/**
 * Team Members: the people a viewer may see, with the general details a
 * read-only viewer needs (an agency reviewing its own people's time): who
 * they are, where they work and who they report to. Never pay, contact
 * details, roles or the audit history; those stay on the employee record,
 * behind Manage employees.
 *
 * <p>Who is listed: the people whose supervisor, or additional supervisor,
 * the viewer is (directReportsOf), the same people the Timecards and Team
 * Punch History lists show, so each row's Timecard link opens that person;
 * or the whole company for someone who manages employees.
 */

/** Enough for any one team; the search narrows a longer list. */
export const TEAM_MEMBERS_CAP = 500;

export type TeamMembersParams = { q?: string; show?: string };

export type TeamMember = {
  id: string;
  name: string;
  badge: string;
  status: "Active" | "On leave" | "Inactive";
  site: string;
  department: string;
  jobTitle: string | null;
  agency: string | null;
  supervisor: string | null;
  shift: string | null;
  /** yyyy-MM-dd */
  hireDate: string;
};

export type TeamMembersData = {
  members: TeamMember[];
  /** Everyone matching, which can be more than the list holds. */
  total: number;
  search: string;
  showInactive: boolean;
};

type Viewer = { employeeId?: string | null; tenantId?: string | null; role: string };

export async function loadTeamMembers(viewer: Viewer, params: TeamMembersParams): Promise<TeamMembersData> {
  const search = (params.q ?? "").trim();
  const showInactive = params.show === "all";

  const ctx = { employeeId: viewer.employeeId ?? "", tenantId: viewer.tenantId ?? null, role: viewer.role };
  const company: Prisma.EmployeeWhereInput = { tenantId: ctx.tenantId ?? "__no_company__" };
  const scope: Prisma.EmployeeWhereInput = (await reachesCompany(ctx, "EMPLOYEE_MANAGE"))
    ? company
    : { AND: [company, directReportsOf(ctx.employeeId || "__none__")] };
  const where: Prisma.EmployeeWhereInput = {
    AND: [
      scope,
      showInactive ? {} : { isActive: true },
      search
        ? {
            OR: [
              { user: { name: { contains: search, mode: "insensitive" } } },
              { wmsId: { contains: search } },
              { employeeCode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const [rows, total] = await Promise.all([
    db.employee.findMany({
      where,
      orderBy: [{ user: { name: "asc" } }],
      take: TEAM_MEMBERS_CAP,
      select: {
        id: true,
        wmsId: true,
        employeeCode: true,
        isActive: true,
        onLeave: true,
        hireDate: true,
        jobTitle: true,
        user: { select: { name: true } },
        site: { select: { name: true } },
        department: { select: { name: true } },
        jobTitleRef: { select: { name: true } },
        agencyRef: { select: { code: true, description: true } },
        supervisor: { select: { user: { select: { name: true } } } },
        additionalSupervisors: { select: { supervisor: { select: { user: { select: { name: true } } } } } },
        shift: { select: { name: true } },
      },
    }),
    db.employee.count({ where }),
  ]);

  return {
    members: rows.map((e) => ({
      id: e.id,
      name: e.user?.name ?? e.employeeCode,
      badge: e.wmsId ?? e.employeeCode,
      status: !e.isActive ? "Inactive" : e.onLeave ? "On leave" : "Active",
      site: e.site.name,
      department: e.department.name,
      jobTitle: e.jobTitleRef?.name ?? e.jobTitle ?? null,
      agency: e.agencyRef ? `${e.agencyRef.code} ${e.agencyRef.description}`.trim() : null,
      // The supervisor of record first, then any additional ones.
      supervisor:
        [e.supervisor?.user?.name, ...e.additionalSupervisors.map((a) => a.supervisor.user?.name).sort()]
          .filter(Boolean)
          .join(", ") || null,
      shift: e.shift?.name ?? null,
      // Stored at midnight Eastern; its UTC date is the calendar day.
      hireDate: e.hireDate.toISOString().slice(0, 10),
    })),
    total,
    search,
    showInactive,
  };
}
