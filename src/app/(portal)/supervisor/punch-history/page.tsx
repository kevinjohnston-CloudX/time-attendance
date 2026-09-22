import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import { format } from "date-fns";
import { TeamPunchHistoryViewer } from "@/components/supervisor/team-punch-history-viewer";
import { PageHeader } from "@/components/ui";

/**
 * Team Punch History, on the portal design's list template.
 *
 * <p>Header, then the filter card, the toolbar and the chips, then the records
 * — the difference from the design's flat table is that the records are one
 * employee's at a time, so the list of people is a pane rather than a column.
 * The composition lives in the viewer; this file stays what it was, which is
 * the five query parameters and the permission-scoped queries they drive.
 *
 * <p>The design's Export action is not here. Nothing in this codebase exports
 * punches, and a button that queues an export that never arrives is worse on
 * this screen than on most: it is the screen people open when a punch is
 * already in dispute.
 */
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

  const isPayroll = await userHasPermission(session.user, "PAY_PERIOD_MANAGE");
  const myEmployeeId = session.user.employeeId;
  const t = session.user.tenantId ?? undefined;

  const sp = await searchParams;

  // Determine date range — use URL params or default to the current pay period
  let startDate: string;
  let endDate: string;

  // Whether the range was asked for or merely defaulted to. The chip that
  // clears it only makes sense in the first case: on the default range there is
  // nothing to go back to.
  const isCustomRange = !!(sp.startDate && sp.endDate);

  if (sp.startDate && sp.endDate) {
    startDate = sp.startDate;
    endDate = sp.endDate;
  } else {
    const today = new Date();
    const currentPP = await db.payPeriod.findFirst({
      where: { startDate: { lte: today }, endDate: { gt: today } },
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
          isRejected: false,
          punchTime: { gte: rangeStart, lte: rangeEnd },
        },
        orderBy: { punchTime: "asc" },
      })
    : [];

  // Payroll sees the whole tenant; a supervisor sees the people who report to
  // them, and the design says so in the subtitle rather than making them count
  // the column.
  const scopeLabel = isPayroll
    ? `${employees.length} employee${employees.length === 1 ? "" : "s"}`
    : `${employees.length} direct report${employees.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Team Punch History"
        subtitle={`${scopeLabel} · every punch, where it came from and whether it has been approved`}
      />
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
        isCustomRange={isCustomRange}
        isPayroll={isPayroll}
        sites={sites}
        selectedSiteId={selectedSiteId}
        departments={departments}
        selectedDepartmentId={selectedDepartmentId}
      />
    </div>
  );
}
