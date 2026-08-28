import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import {
  getActiveEmployeesForTimecards,
  getEmployeePeriods,
  getTimecardByEmployeeAndPeriod,
} from "@/actions/timecard.actions";
import { getPayCodes } from "@/actions/pay-code.actions";
import { getReasonCodes } from "@/actions/reason-code.actions";
import { TimecardViewer } from "@/components/payroll/timecard-viewer";

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
  if (!await userHasPermission(session.user, "PAY_PERIOD_MANAGE")) redirect("/dashboard");

  const t = session.user.tenantId ?? undefined;

  // Load employees + sites + departments in parallel
  const [employeesResult, sites, departments] = await Promise.all([
    getActiveEmployeesForTimecards({
      siteId: sp.siteId ?? null,
      departmentId: sp.departmentId ?? null,
      payPeriodId: sp.periodId ?? null,
    }),
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
    return (
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          Timecards
        </h1>
        <p className="mt-2 text-sm text-zinc-500">No active employees found.</p>
      </div>
    );
  }

  // Resolve selected employee (URL param or first in list)
  const selectedEmployeeId = sp.employeeId ?? employees[0].employeeId;

  // Load periods for the selected employee's rule set
  let periods: { id: string; startDate: string; endDate: string; status: string }[] = [];
  let payFrequency = "BIWEEKLY";
  let selectedPeriodId: string | null = sp.periodId ?? null;

  const periodsResult = await getEmployeePeriods({ employeeId: selectedEmployeeId });
  if (periodsResult.success && periodsResult.data) {
    periods = periodsResult.data.periods;
    payFrequency = periodsResult.data.payFrequency;

    if (!selectedPeriodId && periods.length > 0) {
      const now = new Date();
      const current = periods.find(
        (p) => new Date(p.startDate) <= now && new Date(p.endDate) > now
      );
      selectedPeriodId = current?.id ?? periods[periods.length - 1].id;
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
          payRate: timecard.employee.payRate
            ? Number(timecard.employee.payRate)
            : null,
          payType: timecard.employee.payType,
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
        notes: timecard.notes,
        dayReasons: timecard.dayReasons.map((dr) => ({
          segmentDate: dr.segmentDate.toISOString().slice(0, 10),
          reasonCodeId: dr.reasonCodeId,
          reasonCode: dr.reasonCode,
        })),
      }
    : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            Timecards
          </h1>
        </div>
        <Link
          href="/payroll/pay-periods"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Pay Periods
        </Link>
      </div>

      <TimecardViewer
        payPeriods={periods}
        selectedPeriodId={selectedPeriodId}
        employees={employees}
        selectedEmployeeId={selectedEmployeeId}
        timecard={serializedTimecard}
        payFrequency={payFrequency}
        userRole={session.user.role ?? "EMPLOYEE"}
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
    </div>
  );
}
