import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import {
  getTimecardEmployeeList,
  getTimecardDetail,
} from "@/actions/timecard.actions";
import { getPayCodes } from "@/actions/pay-code.actions";
import { getReasonCodes } from "@/actions/reason-code.actions";
import { TimecardViewer } from "@/components/payroll/timecard-viewer";

export default async function TimecardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    payPeriodId?: string;
    employeeId?: string;
    customStart?: string;
    customEnd?: string;
    siteId?: string;
    departmentId?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PAY_PERIOD_MANAGE")) redirect("/dashboard");

  const t = session.user.tenantId ?? undefined;

  // Fetch tenant pay frequency + pay periods + sites + departments in parallel
  const [tenant, payPeriods, sites, departments] = await Promise.all([
    session.user.tenantId
      ? db.tenant.findUnique({
          where: { id: session.user.tenantId },
          select: { payFrequency: true },
        })
      : null,
    db.payPeriod.findMany({ orderBy: { startDate: "desc" } }),
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

  const payFrequency = tenant?.payFrequency ?? "BIWEEKLY";

  if (payPeriods.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          Timecards
        </h1>
        <p className="mt-2 text-sm text-zinc-500">No pay periods found.</p>
      </div>
    );
  }

  const today = new Date();
  const currentPayPeriod = payPeriods.find(
    (pp) => today >= pp.startDate && today <= pp.endDate
  );

  // Determine which pay period to load — explicit param, custom range start, or current/first
  let selectedPayPeriodId: string;
  if (sp.payPeriodId) {
    selectedPayPeriodId = sp.payPeriodId;
  } else if (sp.customStart) {
    const customDate = new Date(sp.customStart + "T12:00:00");
    const pp = payPeriods.find((p) => customDate >= p.startDate && customDate <= p.endDate);
    selectedPayPeriodId = pp?.id ?? (currentPayPeriod?.id ?? payPeriods[0].id);
  } else {
    selectedPayPeriodId = currentPayPeriod?.id ?? payPeriods[0].id;
  }

  const employeeResult = await getTimecardEmployeeList({
    payPeriodId: selectedPayPeriodId,
    siteId: sp.siteId ?? null,
    departmentId: sp.departmentId ?? null,
  });
  const employees = employeeResult.success ? employeeResult.data : [];

  // Auto-select first employee or use URL param
  const selectedEmployeeId =
    sp.employeeId ??
    (employees.length > 0 ? employees[0].employeeId : null);

  // Find the selected employee's timesheet
  const selectedTimesheetId = selectedEmployeeId
    ? (employees.find((e) => e.employeeId === selectedEmployeeId)
        ?.timesheetId ?? null)
    : null;

  // Fetch pay codes and reason codes for the tenant
  const [payCodesResult, reasonCodesResult] = await Promise.all([
    getPayCodes({}),
    getReasonCodes(),
  ]);
  const payCodes = payCodesResult.success ? payCodesResult.data : [];
  const reasonCodes = reasonCodesResult.success ? reasonCodesResult.data : [];

  let timecard = null;
  if (selectedTimesheetId) {
    const result = await getTimecardDetail({
      timesheetId: selectedTimesheetId,
    });
    if (result.success) {
      timecard = result.data;
    }
  }

  // Serialize for client component (convert Date objects to ISO strings)
  const serializedPayPeriods = payPeriods.map((pp) => ({
    id: pp.id,
    startDate: pp.startDate.toISOString(),
    endDate: pp.endDate.toISOString(),
    status: pp.status,
  }));

  const serializedTimecard = timecard
    ? {
        timesheetId: timecard.id,
        status: timecard.status,
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
          },
        },
        punches: timecard.punches.map((p) => ({
          id: p.id,
          punchType: p.punchType,
          roundedTime: p.roundedTime.toISOString(),
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
        payPeriods={serializedPayPeriods}
        selectedPayPeriodId={selectedPayPeriodId}
        employees={employees}
        selectedEmployeeId={selectedEmployeeId}
        timecard={serializedTimecard}
        payFrequency={payFrequency}
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
