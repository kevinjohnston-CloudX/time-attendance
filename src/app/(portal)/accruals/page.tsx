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

  const employeeWhere = canViewAny
    ? {}
    : { supervisorId: session.user.employeeId ?? undefined };

  const [employees, sites] = await Promise.all([
    db.employee.findMany({
      where: employeeWhere,
      include: {
        user: { select: { name: true } },
        department: { select: { name: true } },
        site: { select: { id: true, name: true } },
        payCategory: { select: { number: true, description: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    db.site.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const rows = employees.map((emp) => ({
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

  const sp = (await searchParams) ?? {};
  const filters = {
    q: (sp.q ?? "").trim(),
    site: sp.site ?? "",
    dept: sp.dept ?? "",
    status: parseStatus(sp.status),
  };

  const needle = filters.q.toLowerCase();
  const visible = rows.filter((r) => {
    if (filters.status === "active" && !r.isActive) return false;
    if (filters.status === "inactive" && r.isActive) return false;
    if (filters.site && r.siteId !== filters.site) return false;
    if (filters.dept && r.department !== filters.dept) return false;
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      r.employeeCode.toLowerCase().includes(needle) ||
      r.department.toLowerCase().includes(needle)
    );
  });

  // Departments come from the rows rather than a query of their own, so the
  // dropdown can only ever offer a department this viewer already has someone
  // in — a supervisor picking "Receiving" and getting an empty list would read
  // as "nobody in Receiving" rather than "nobody of yours".
  const departments = [...new Set(rows.map((r) => r.department))].sort();

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
        total={rows.length}
        sites={sites}
        departments={departments}
        filters={filters}
      />
    </div>
  );
}
