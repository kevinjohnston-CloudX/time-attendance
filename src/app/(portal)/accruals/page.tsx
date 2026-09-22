import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import { format } from "date-fns";
import { AccrualsEmployeeList } from "@/components/admin/accruals-employee-list";
import { LinkButton, PageHeader } from "@/components/ui";

/**
 * Accruals, on the design's list template: toolbar, applied-filter chips, then
 * the table in a padding-free card.
 *
 * <p>The filters moved out of the list component's React state and into the
 * query string. A supervisor who has narrowed this to one site and one
 * department is usually about to send it to somebody, and state that lives
 * only in the component cannot be pasted into a message or survive a reload.
 *
 * <p>Nothing about the query changed: it is still every employee the viewer is
 * scoped to, and the filters narrow the rows that query already returned. A
 * filter that re-queried would be a second, differently-scoped read of the
 * employee table, which is exactly the kind of change that quietly widens who
 * you can see.
 */

/** Active only, unless asked otherwise — the view this page has always opened on. */
type StatusFilter = "active" | "inactive" | "all";

function parseStatus(raw: string | undefined): StatusFilter {
  return raw === "inactive" || raw === "all" ? raw : "active";
}

export default async function AccrualsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; site?: string; dept?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canViewAny  = await userHasPermission(session.user, "ACCRUAL_VIEW_ANY");
  const canViewTeam = canViewAny  || await userHasPermission(session.user, "ACCRUAL_VIEW_TEAM");
  const canViewOwn  = canViewTeam || await userHasPermission(session.user, "ACCRUAL_VIEW_OWN");

  if (!canViewOwn) redirect("/dashboard");

  // Employees with only own-scope go straight to their own page
  if (!canViewTeam && session.user.employeeId) {
    redirect(`/accruals/${session.user.employeeId}`);
  }

  const sp = (await searchParams) ?? {};
  const filters = {
    q: (sp.q ?? "").trim(),
    site: sp.site ?? "",
    dept: sp.dept ?? "",
    status: parseStatus(sp.status),
  };

  /**
   * Who this viewer may see at all, before any filter on screen.
   *
   * <p>Scoped by tenant as well as by supervisor. It was previously scoped by
   * supervisor alone, so an unrestricted viewer read the employee table
   * across tenants.
   */
  const employeeScope = {
    tenantId: session.user.tenantId ?? undefined,
    ...(canViewAny ? {} : { supervisorId: session.user.employeeId ?? undefined }),
  };

  /**
   * The filters, applied in the query rather than to the rows afterwards.
   *
   * <p>This page used to read every employee in the tenant with every column
   * on them and narrow the result in JavaScript: 7,420 records fetched and
   * 2.6MB sent to draw a list of 872 active people. The rows on screen are
   * the same ones; only the place the narrowing happens has moved.
   */
  const needle = filters.q;
  const employeeWhere = {
    ...employeeScope,
    ...(filters.status === "active"   ? { isActive: true }  : {}),
    ...(filters.status === "inactive" ? { isActive: false } : {}),
    ...(filters.site ? { siteId: filters.site } : {}),
    ...(filters.dept ? { department: { name: filters.dept } } : {}),
    ...(needle
      ? {
          OR: [
            { user:       { name: { contains: needle, mode: "insensitive" as const } } },
            { employeeCode:       { contains: needle, mode: "insensitive" as const } },
            { department: { name: { contains: needle, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [employees, sites, scopedDepartments, total] = await Promise.all([
    db.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        employeeCode: true,
        isActive: true,
        hireDate: true,
        user:        { select: { name: true } },
        department:  { select: { name: true } },
        site:        { select: { id: true, name: true } },
        payCategory: { select: { number: true, description: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    db.site.findMany({
      where: { isActive: true, tenantId: session.user.tenantId ?? undefined },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // The dropdown still offers only departments this viewer has somebody in,
    // which used to fall out of having every row in memory. It is now its own
    // query, and deliberately scoped to the viewer rather than to the current
    // filters, so picking a department never empties the list it came from.
    db.department.findMany({
      where: { employees: { some: employeeScope } },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    // Everything the viewer is scoped to, for "showing n of N" and for the
    // empty state, which says something different when there is genuinely
    // nobody than when a filter is hiding them.
    db.employee.count({ where: employeeScope }),
  ]);

  const visible = employees.map((emp) => ({
    id: emp.id,
    name: emp.user?.name ?? emp.id,
    employeeCode: emp.employeeCode,
    department: emp.department.name,
    siteId: emp.site.id,
    site: emp.site.name,
    isActive: emp.isActive,
    payCategory: emp.payCategory
      ? emp.payCategory.description ?? `Category ${emp.payCategory.number}`
      : null,
    hireDate: emp.hireDate ? format(emp.hireDate, "MMM d, yyyy") : null,
  }));

  const departments = scopedDepartments.map((d) => d.name);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Accruals"
        subtitle="Leave balances, accrual ledger and adjustments"
        actions={
          // Only for the audience that reaches this page through the admin hub.
          // It is also a main-nav page under Time, and a supervisor who arrived
          // from the sidebar has no Administration to go back to.
          canViewAny ? (
            <LinkButton href="/admin" hierarchy="tertiary">
              ← Administration
            </LinkButton>
          ) : undefined
        }
      />

      <AccrualsEmployeeList
        employees={visible}
        total={total}
        sites={sites}
        departments={departments}
        filters={filters}
      />
    </div>
  );
}
