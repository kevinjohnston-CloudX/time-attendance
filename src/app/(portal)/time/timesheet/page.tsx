import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseUtcDate } from "@/lib/utils/date";
import { TimesheetViewer } from "@/components/time/timesheet-viewer";

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ payPeriodId?: string; customStart?: string; customEnd?: string }>;
}) {
  const { payPeriodId, customStart, customEnd } = await searchParams;
  const session = await auth();
  if (!session?.user?.employeeId) redirect("/dashboard");

  // Fetch all timesheets for navigation list
  const timesheets = await db.timesheet.findMany({
    where: { employeeId: session.user.employeeId },
    include: { payPeriod: true, overtimeBuckets: true },
    orderBy: { payPeriod: { startDate: "asc" } },
  });

  // Determine which timesheet to show
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  let selectedTs =
    payPeriodId
      ? timesheets.find((ts) => ts.payPeriod.id === payPeriodId)
      : undefined;

  if (!selectedTs && customStart && customEnd) {
    const rangeStart = new Date(customStart);
    const rangeEnd = new Date(customEnd);
    selectedTs = timesheets.find((ts) => {
      const s = parseUtcDate(ts.payPeriod.startDate);
      const e = parseUtcDate(ts.payPeriod.endDate);
      return s <= rangeEnd && e >= rangeStart;
    });
  }

  if (!selectedTs && !payPeriodId && !customStart) {
    // Default to the pay period containing today, else most recent
    selectedTs =
      timesheets.find((ts) => {
        const s = parseUtcDate(ts.payPeriod.startDate);
        const e = parseUtcDate(ts.payPeriod.endDate);
        return s <= todayMidnight && todayMidnight <= e;
      }) ?? timesheets[timesheets.length - 1];
  }

  // Fetch full detail for the selected timesheet
  const rawDetail = selectedTs
    ? await db.timesheet.findUnique({
        where: { id: selectedTs.id },
        include: {
          payPeriod: true,
          punches: {
            where: { isApproved: true, correctedById: null },
            orderBy: { roundedTime: "asc" },
          },
          segments: { orderBy: { startTime: "asc" } },
          overtimeBuckets: true,
          exceptions: { where: { resolvedAt: null } },
        },
      })
    : null;

  // Serialize — client component cannot receive Prisma Date objects
  const serializedTimesheets = timesheets.map((ts) => ({
    timesheetId: ts.id,
    payPeriodId: ts.payPeriod.id,
    payPeriod: {
      id: ts.payPeriod.id,
      startDate: ts.payPeriod.startDate.toISOString(),
      endDate: ts.payPeriod.endDate.toISOString(),
    },
    status: ts.status,
    totalMinutes: ts.overtimeBuckets.reduce((a, b) => a + b.totalMinutes, 0),
  }));

  const serializedDetail = rawDetail
    ? {
        timesheetId: rawDetail.id,
        status: rawDetail.status,
        payPeriod: {
          id: rawDetail.payPeriod.id,
          startDate: rawDetail.payPeriod.startDate.toISOString(),
          endDate: rawDetail.payPeriod.endDate.toISOString(),
        },
        punches: rawDetail.punches.map((p) => ({
          id: p.id,
          punchType: p.punchType,
          roundedTime: p.roundedTime.toISOString(),
        })),
        segments: rawDetail.segments.map((s) => ({
          id: s.id,
          segmentType: s.segmentType,
          segmentDate: s.segmentDate.toISOString(),
          startTime: s.startTime.toISOString(),
          endTime: s.endTime.toISOString(),
          durationMinutes: s.durationMinutes,
          payBucket: s.payBucket,
          payBucketOverride: s.payBucketOverride,
          isPaid: s.isPaid,
        })),
        overtimeBuckets: rawDetail.overtimeBuckets.map((b) => ({
          bucket: b.bucket,
          totalMinutes: b.totalMinutes,
        })),
        exceptionCount: rawDetail.exceptions.length,
      }
    : null;

  return (
    <TimesheetViewer
      timesheets={serializedTimesheets}
      selectedPayPeriodId={selectedTs?.payPeriod.id ?? null}
      detail={serializedDetail}
      customStart={customStart}
      customEnd={customEnd}
    />
  );
}
