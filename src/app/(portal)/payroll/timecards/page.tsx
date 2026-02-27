import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import {
  getTimecardEmployeeList,
  getTimecardDetail,
} from "@/actions/timecard.actions";
import { TimecardViewer } from "@/components/payroll/timecard-viewer";

export default async function TimecardsPage({
  searchParams,
}: {
  searchParams: Promise<{ payPeriodId?: string; employeeId?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "PAY_PERIOD_MANAGE"))
    redirect("/dashboard");

  const payPeriods = await db.payPeriod.findMany({
    orderBy: { startDate: "desc" },
  });

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

  const selectedPayPeriodId = sp.payPeriodId ?? payPeriods[0].id;

  const employeeResult = await getTimecardEmployeeList({
    payPeriodId: selectedPayPeriodId,
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
          isPaid: s.isPaid,
        })),
        overtimeBuckets: timecard.overtimeBuckets.map((b) => ({
          bucket: b.bucket,
          totalMinutes: b.totalMinutes,
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
          <p className="mt-1 text-sm text-zinc-500">
            View employee timecards by pay period.
          </p>
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
      />
    </div>
  );
}
