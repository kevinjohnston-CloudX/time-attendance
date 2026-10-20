import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import { getSubordinateIds } from "@/lib/get-subordinate-ids";
import { siteLimit } from "@/lib/rbac/scope";
import type { Prisma } from "@prisma/client";
import { format } from "date-fns";
import { parseUtcDate } from "@/lib/utils/date";
import { AccrualsEmployeeList } from "@/classic/components/admin/accruals-employee-list";

export default async function AccrualsPage() {
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

  // Always the viewer's own company: seeing everyone's used to read every
  // company's employees and sites. A Payroll Admin held to some sites sees the
  // people at those sites only, as on Timecards.
  const tenantId = session.user.tenantId ?? "__no_company__";
  const siteIds = canViewAny ? await siteLimit({ employeeId: session.user.employeeId ?? "", role: session.user.role ?? "" }) : null;
  let employeeWhere: Prisma.EmployeeWhereInput = { tenantId, ...(siteIds ? { siteId: { in: siteIds } } : {}) };
  if (!canViewAny && session.user.employeeId) {
    const subordinateIds = await getSubordinateIds(
      session.user.employeeId,
      session.user.tenantId ?? null
    );
    employeeWhere = {
      tenantId,
      OR: [
        { id: { in: subordinateIds } },
        { id: session.user.employeeId },
      ],
    };
  }

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
      where: { isActive: true, tenantId, ...(siteIds ? { id: { in: siteIds } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const rows = employees.map((emp) => ({
    id: emp.id,
    name: emp.user?.name ?? emp.id,
    employeeCode: emp.employeeCode,
    wmsId: emp.wmsId ?? null,
    department: emp.department.name,
    siteId: emp.site.id,
    site: emp.site.name,
    isActive: emp.isActive,
    payCategory: emp.payCategory
      ? emp.payCategory.description ?? `Category ${emp.payCategory.number}`
      : null,
    hireDate: emp.hireDate ? format(parseUtcDate(emp.hireDate), "MMM d, yyyy") : null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Accruals</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Leave balances and accrual history per employee.
      </p>
      <AccrualsEmployeeList employees={rows} sites={sites} />
    </div>
  );
}
