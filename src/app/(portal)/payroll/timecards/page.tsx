import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import {
  getActiveEmployeesForTimecards,
  getTeamEmployeesForTimecards,
  getEmployeePeriods,
  getTimecardByEmployeeAndPeriod,
} from "@/actions/timecard.actions";
import { getPayCodes } from "@/actions/pay-code.actions";
import { getReasonCodes } from "@/actions/reason-code.actions";
import { TimecardViewer } from "@/components/payroll/timecard-viewer";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { Users } from "lucide-react";

/**
 * Timecards, as the portal design lays it out: the list template for choosing
 * whose hours you are looking at, and the timesheet grid for the hours
 * themselves.
 *
 * <p>This page owns the two filters that belong in the URL — site and
 * department. They are query parameters rather than component state because a
 * payroll screen narrowed to one department is something people send each
 * other, and because the employee list is re-queried per site: the scope of
 * that query is what the filter changes, not which of the loaded rows are
 * shown.
 *
 * <p>Everything below the header is rendered by {@link TimecardViewer}. The
 * toolbar, the view segments and the filter chips live there rather than here
 * because they sit on the same state as the employee picker, and splitting a
 * toolbar from the list it filters is how the two drift apart.
 */
export default async function TimecardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    employeeId?: string;
    periodId?: string;
    siteId?: string;
    departmentId?: string;
    customStart?: string;
    customEnd?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [canViewTeam, canViewAll, canEditTeam, canEditAll] = await Promise.all([
    userHasPermission(session.user, "TIMECARD_VIEW_TEAM"),
    userHasPermission(session.user, "TIMECARD_VIEW_ANY"),
    userHasPermission(session.user, "TIMECARD_EDIT_TEAM"),
    userHasPermission(session.user, "TIMECARD_EDIT_ANY"),
  ]);
  if (!canViewTeam && !canViewAll && !canEditTeam && !canEditAll) redirect("/dashboard");

  const isAllScope = canViewAll || canEditAll;
  const canEdit = canEditTeam || canEditAll;

  const t = session.user.tenantId ?? undefined;

  // Load employees + sites + departments in parallel
  const [employeesResult, sites, departments] = await Promise.all([
    isAllScope
      ? getActiveEmployeesForTimecards({
          siteId: sp.siteId ?? null,
          departmentId: sp.departmentId ?? null,
          payPeriodId: sp.periodId ?? null,
        })
      : getTeamEmployeesForTimecards({}),
    db.site.findMany({
      where: { isActive: true, ...(t ? { tenantId: t } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.department.findMany({
      where: {
        isActive: true,
        ...(t ? { tenantId: t } : {}),
        ...(sp.siteId ? { sites: { some: { siteId: sp.siteId } } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const employees = employeesResult.success ? employeesResult.data : [];

  if (employees.length === 0) {
    const narrowed = Boolean(sp.siteId || sp.departmentId || sp.periodId);
    const narrowedBy = [
      sp.siteId && sites.find((s) => s.id === sp.siteId)?.name,
      sp.departmentId && departments.find((d) => d.id === sp.departmentId)?.name,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className="flex flex-col gap-4">
        {/* The subtitle names the filters that produced the empty list. "No
            employees" and "no employees in Shipping at the Newark DC" look
            identical without it, and the difference is whether somebody
            concludes a site has nobody to pay. */}
        <PageHeader pinned
          title="Timecards"
          subtitle={narrowedBy || (narrowed ? "Filtered" : undefined)}
          actions={
            narrowed ? (
              <LinkButton href="/payroll/timecards" hierarchy="secondary">
                Clear Filters
              </LinkButton>
            ) : (
              <LinkButton href="/payroll/pay-periods" hierarchy="secondary">
                Pay Periods
              </LinkButton>
            )
          }
        />
        <Card padding={0}>
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title={narrowed ? "No employees match these filters" : "No active employees"}
            body={
              narrowed
                ? "There may be employees outside the site, department or pay period selected."
                : "Nobody at this tenant is active, so there is nothing to show hours for."
            }
          />
        </Card>
      </div>
    );
  }

  // Resolve selected employee (URL param or first in list)
  // Only someone on the list the caller was given: an id typed into the
  // address for anybody else opens the first person instead.
  const selectedEmployeeId =
    sp.employeeId && employees.some((e) => e.employeeId === sp.employeeId) ? sp.employeeId : employees[0].employeeId;

  // Load periods for the selected employee's rule set
  let periods: { id: string; startDate: string; endDate: string; status: string }[] = [];
  let payFrequency = "BIWEEKLY";
  let selectedPeriodId: string | null = sp.periodId ?? null;

  const periodsResult = await getEmployeePeriods({ employeeId: selectedEmployeeId });
  if (periodsResult.success && periodsResult.data) {
    periods = periodsResult.data.periods;
    payFrequency = periodsResult.data.payFrequency;

    const now = new Date();
    const periodIds = new Set(periods.map((p) => p.id));

    if (!selectedPeriodId || !periodIds.has(selectedPeriodId)) {
      // URL period doesn't belong to this employee's rule set — find their current period
      const current = periods.find(
        (p) => new Date(p.startDate) <= now && new Date(p.endDate) > now
      );
      selectedPeriodId = current?.id ?? periods[periods.length - 1]?.id ?? null;
    }
  }

  // Load timecard for employee + period (null = no punches yet, not an error)
  let timecard = null;
  if (selectedPeriodId) {
    const result = await getTimecardByEmployeeAndPeriod({
      employeeId: selectedEmployeeId,
      periodId: selectedPeriodId,
    });
    if (result.success) {
      timecard = result.data ?? null;
    }
  }

  // Fetch pay codes and reason codes
  const [payCodesResult, reasonCodesResult] = await Promise.all([
    getPayCodes({}),
    getReasonCodes(),
  ]);
  const payCodes = payCodesResult.success ? payCodesResult.data : [];
  const reasonCodes = reasonCodesResult.success ? reasonCodesResult.data : [];

  // Serialize timecard for client component
  const serializedTimecard = timecard
    ? {
        timesheetId: timecard.id,
        status: timecard.status,
        otAuthorized: timecard.otAuthorized,
        exceptionCount: timecard.exceptions.length,
        exceptions: timecard.exceptions.map((e) => ({
          id: e.id,
          exceptionType: e.exceptionType,
          occurredAt: e.occurredAt.toISOString(),
        })),
        payPeriod: {
          startDate: timecard.payPeriod.startDate.toISOString(),
          endDate: timecard.payPeriod.endDate.toISOString(),
        },
        employee: {
          user: timecard.employee.user
            ? { name: timecard.employee.user.name }
            : null,
          department: { name: timecard.employee.department.name },
          employeeCode: timecard.employee.employeeCode,
          wmsId: timecard.employee.wmsId ?? null,
          payRate: timecard.employee.payRate
            ? Number(timecard.employee.payRate)
            : null,
          payType: timecard.employee.payType,
          shift: timecard.employee.shift
            ? { mealConfig: timecard.employee.shift.mealConfig as { autoDeduct?: boolean; meals?: { workAtLeastHours: number; deductMinutes: number }[] } | null }
            : null,
          ruleSet: {
            autoDeductMeal: timecard.employee.ruleSet.autoDeductMeal,
            mealBreakMinutes: timecard.employee.ruleSet.mealBreakMinutes,
            mealBreakAfterMinutes: timecard.employee.ruleSet.mealBreakAfterMinutes,
            overtimeRequiresAuth: timecard.employee.ruleSet.overtimeRequiresAuth,
            allowTimesheetOtAuth: timecard.employee.ruleSet.allowTimesheetOtAuth,
            defaultPayCodeId: timecard.employee.ruleSet.defaultPayCodeId ?? null,
          },
        },
        punches: timecard.punches.map((p) => ({
          id: p.id,
          punchType: p.punchType,
          roundedTime: p.roundedTime.toISOString(),
          source: p.source,
        })),
        segments: timecard.segments.map((s) => ({
          id: s.id,
          segmentType: s.segmentType,
          startTime: s.startTime.toISOString(),
          endTime: s.endTime.toISOString(),
          durationMinutes: s.durationMinutes,
          segmentDate: s.segmentDate.toISOString(),
          payBucket: s.payBucket,
          payBucketOverride: s.payBucketOverride ?? null,
          isPaid: s.isPaid,
          leaveRequest: s.leaveRequest
            ? { id: s.leaveRequest.id, leaveType: s.leaveRequest.leaveType }
            : null,
          payCode: s.payCode
            ? { id: s.payCode.id, code: s.payCode.code, label: s.payCode.label }
            : null,
        })),
        overtimeBuckets: timecard.overtimeBuckets.map((b) => ({
          bucket: b.bucket,
          totalMinutes: b.totalMinutes,
        })),
        mealWaivers: timecard.mealWaivers,
        mealPremiumWaivers: timecard.mealPremiumWaivers,
        notes: timecard.notes,
        dayReasons: timecard.dayReasons.map((dr) => ({
          segmentDate: dr.segmentDate.toISOString().slice(0, 10),
          reasonCodeId: dr.reasonCodeId,
          reasonCode: dr.reasonCode,
        })),
      }
    : null;

  // The line under the title. The dates themselves are on the pay period
  // control beside it, and the viewer puts the pay frequency first.
  const subtitle = [
    `${employees.length} ${employees.length === 1 ? "employee" : "employees"}`,
    canEdit ? null : "Read only",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <TimecardViewer
        // The viewer draws the page header, so the pay period control and
        // the site and department filters sit in its title row. The design
        // gives it a "Send to ADP" action; that push only works on a locked
        // pay period and happens once per period, so it lives on Pay Periods,
        // where locking happens, and this links there.
        subtitle={subtitle}
        headerActions={
          <LinkButton href="/payroll/pay-periods" hierarchy="secondary">
            View pay periods
          </LinkButton>
        }
        payPeriods={periods}
        selectedPeriodId={selectedPeriodId}
        employees={employees}
        selectedEmployeeId={selectedEmployeeId}
        timecard={serializedTimecard}
        payFrequency={payFrequency}
        userRole={session.user.role ?? "EMPLOYEE"}
        readOnly={!canEdit}
        customStart={sp.customStart ?? null}
        customEnd={sp.customEnd ?? null}
        payCodes={payCodes.map((pc) => ({
          id: pc.id,
          code: pc.code,
          label: pc.label,
        }))}
        reasonCodes={reasonCodes.map((rc) => ({
          id: rc.id,
          code: rc.code,
          label: rc.label,
          color: rc.color ?? null,
        }))}
        sites={sites}
        selectedSiteId={sp.siteId ?? null}
        departments={departments}
        selectedDepartmentId={sp.departmentId ?? null}
      />
  );
}
