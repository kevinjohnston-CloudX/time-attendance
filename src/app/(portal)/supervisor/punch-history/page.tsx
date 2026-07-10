import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import { format } from "date-fns";
import { TeamPunchHistoryViewer } from "@/components/supervisor/team-punch-history-viewer";

export default async function TeamPunchHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    startDate?: string;
    endDate?: string;
    employeeId?: string;
    siteId?: string;
    departmentId?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PUNCH_VIEW_TEAM")) redirect("/dashboard");

  const isPayroll = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"].includes(
    session.user.role ?? ""
  );
  const myEmployeeId = session.user.employeeId;
  const t = session.user.tenantId ?? undefined;

  const sp = await searchParams;

  // Determine date range — use URL params or default to the current pay period
  let startDate: string;
  let endDate: string;

  if (sp.startDate && sp.endDate) {
    startDate = sp.startDate;
    endDate = sp.endDate;
  } else {
    const today = new Date();
    const currentPP = await db.payPeriod.findFirst({
      where: { startDate: { lte: today }, endDate: { gte: today } },
    });
    if (currentPP) {
      startDate = format(currentPP.startDate, "yyyy-MM-dd");
      endDate = format(currentPP.endDate, "yyyy-MM-dd");
    } else {
      const twoWeeksAgo = new Date(today);
      twoWeeksAgo.setDate(today.getDate() - 13);
      startDate = format(twoWeeksAgo, "yyyy-MM-dd");
      endDate = format(today, "yyyy-MM-dd");
    }
  }

  // Sites — payroll users only
  const sites = isPayroll
    ? await db.site.findMany({
        where: { isActive: true, ...(t ? { tenantId: t } : {}) },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  const selectedSiteId = isPayroll ? (sp.siteId ?? null) : null;
  const selectedDepartmentId = isPayroll ? (sp.departmentId ?? null) : null;

  // Departments for the filter dropdown — payroll+ only, optionally filtered by site
  const departments = isPayroll
    ? await db.department.findMany({
        where: {
          isActive: true,
          ...(t ? { tenantId: t } : {}),
          ...(selectedSiteId ? { sites: { some: { siteId: selectedSiteId } } } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  // Team employees, optionally filtered by site and/or department
  const employees = await db.employee.findMany({
    where: {
      ...(isPayroll
        ? { isActive: true, ...(t ? { tenantId: t } : {}) }
        : { supervisorId: myEmployeeId, isActive: true, ...(t ? { tenantId: t } : {}) }),
      ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
      ...(selectedDepartmentId ? { departmentId: selectedDepartmentId } : {}),
    },
    include: {
      user: { select: { name: true } },
      department: { select: { name: true } },
    },
    orderBy: { user: { name: "asc" } },
  });

  const selectedEmployeeId =
    sp.employeeId ?? (employees.length > 0 ? employees[0].id : null);

  // Punches for the selected employee within the date range
  const rangeStart = new Date(startDate + "T00:00:00");
  const rangeEnd = new Date(endDate + "T23:59:59");

  const punches = selectedEmployeeId
    ? await db.punch.findMany({
        where: {
          employeeId: selectedEmployeeId,
          punchTime: { gte: rangeStart, lte: rangeEnd },
        },
        orderBy: { punchTime: "asc" },
      })
    : [];

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-zinc-900 dark:text-white">
        Team Punch History
      </h1>
      <TeamPunchHistoryViewer
        employees={employees.map((emp) => ({
          id: emp.id,
          name: emp.user?.name ?? emp.employeeCode,
          employeeCode: emp.employeeCode,
          department: emp.department?.name ?? "—",
        }))}
        selectedEmployeeId={selectedEmployeeId}
        punches={punches.map((p) => ({
          id: p.id,
          punchTime: p.punchTime.toISOString(),
          roundedTime: p.roundedTime.toISOString(),
          punchType: p.punchType,
          source: p.source,
          isApproved: p.isApproved,
          correctedById: p.correctedById,
          correctsId: p.correctsId,
        }))}
        startDate={startDate}
        endDate={endDate}
        isPayroll={isPayroll}
        sites={sites}
        selectedSiteId={selectedSiteId}
        departments={departments}
        selectedDepartmentId={selectedDepartmentId}
      />
    </div>
  );
}
