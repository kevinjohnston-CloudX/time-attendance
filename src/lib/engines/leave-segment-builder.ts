import { eachDayOfInterval, startOfDay, format, max, min } from "date-fns";
import { db } from "@/lib/db";
import { findOrCreateTimesheet } from "@/lib/utils/timesheet";
import type { LeaveCategory, PayBucket } from "@prisma/client";
import type { TxClient } from "@/types/prisma";

// LeaveCategory and PayBucket share the same values for leave types
const CATEGORY_TO_BUCKET: Record<LeaveCategory, PayBucket> = {
  PTO: "PTO",
  SICK: "SICK",
  HOLIDAY: "HOLIDAY",
  FMLA: "FMLA",
  BEREAVEMENT: "BEREAVEMENT",
  JURY_DUTY: "JURY_DUTY",
  MILITARY: "MILITARY",
  UNPAID: "UNPAID",
};

const LEAVE_BUCKET_VALUES: PayBucket[] = [
  "PTO", "SICK", "HOLIDAY", "FMLA",
  "BEREAVEMENT", "JURY_DUTY", "MILITARY", "UNPAID",
];

/**
 * Idempotent: sync leave segments for a single LeaveRequest.
 *
 * Wrapped in a transaction so deletion + recreation is atomic.
 * 1. Deletes any existing segments linked to this request.
 * 2. If the request is APPROVED or POSTED, creates one LEAVE segment per day
 *    on the correct timesheet(s), plus refreshes OvertimeBucket rows.
 * 3. If the request is in any other status, stops after deletion.
 */
export async function syncLeaveSegments(
  leaveRequestId: string
): Promise<void> {
  await db.$transaction(async (tx) => {
    // 1. Always delete existing segments for this request
    const oldSegments = await tx.workSegment.findMany({
      where: { leaveRequestId },
      select: { timesheetId: true },
    });
    const affectedTimesheetIds = [
      ...new Set(oldSegments.map((s) => s.timesheetId)),
    ];

    await tx.workSegment.deleteMany({ where: { leaveRequestId } });

    // Refresh leave buckets on timesheets that lost segments
    for (const tsId of affectedTimesheetIds) {
      await refreshLeaveBuckets(tsId, tx);
    }

    // 2. Load the request — only proceed if APPROVED or POSTED
    const request = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: leaveRequestId },
      include: { leaveType: true },
    });

    if (request.status !== "APPROVED" && request.status !== "POSTED") return;

    // 3. Find all pay periods that overlap the leave date range
    const payPeriods = await tx.payPeriod.findMany({
      where: {
        startDate: { lte: request.endDate },
        endDate: { gte: request.startDate },
      },
    });

    if (payPeriods.length === 0) return;

    // 4. Build a map of date → timesheetId (finding or creating timesheets)
    const leaveDays = eachDayOfInterval({
      start: request.startDate,
      end: request.endDate,
    });
    const minutesPerDay = Math.round(request.durationMinutes / leaveDays.length);
    const bucket = CATEGORY_TO_BUCKET[request.leaveType.category];

    const timesheetsByDate = new Map<string, string>();

    for (const pp of payPeriods) {
      const overlapStart = max([pp.startDate, request.startDate]);
      const overlapEnd = min([pp.endDate, request.endDate]);
      const overlapDays = eachDayOfInterval({
        start: overlapStart,
        end: overlapEnd,
      });

      if (overlapDays.length === 0) continue;

      const timesheet = await findOrCreateTimesheet(
        request.employeeId,
        pp.id,
        tx
      );

      for (const day of overlapDays) {
        timesheetsByDate.set(format(day, "yyyy-MM-dd"), timesheet.id);
      }
    }

    // 5. Create leave segments — one per day
    const segments = leaveDays
      .filter((day) => timesheetsByDate.has(format(day, "yyyy-MM-dd")))
      .map((day) => {
        const dayStart = startOfDay(day);
        // Nominal 09:00-17:00 for display purposes
        const start = new Date(dayStart.getTime() + 9 * 60 * 60_000);
        const end = new Date(start.getTime() + minutesPerDay * 60_000);

        return {
          timesheetId: timesheetsByDate.get(format(day, "yyyy-MM-dd"))!,
          segmentType: "LEAVE" as const,
          startTime: start,
          endTime: end,
          durationMinutes: minutesPerDay,
          segmentDate: dayStart,
          isPaid: request.leaveType.isPaid,
          payBucket: bucket,
          isSplit: false,
          leaveRequestId: request.id,
        };
      });

    if (segments.length > 0) {
      await tx.workSegment.createMany({ data: segments });
    }

    // 6. Refresh OvertimeBucket rows for leave buckets on affected timesheets
    const newTimesheetIds = [
      ...new Set(segments.map((s) => s.timesheetId)),
    ];
    for (const tsId of newTimesheetIds) {
      await refreshLeaveBuckets(tsId, tx);
    }
  });
}

/**
 * Recompute OvertimeBucket rows for leave-type pay buckets on a timesheet.
 * Does NOT touch REG/OT/DT buckets (those are managed by the OT engine).
 */
async function refreshLeaveBuckets(
  timesheetId: string,
  tx: TxClient
): Promise<void> {
  const leaveSegments = await tx.workSegment.findMany({
    where: { timesheetId, segmentType: "LEAVE" },
  });

  // Group by payBucket
  const bucketTotals = new Map<PayBucket, number>();
  for (const seg of leaveSegments) {
    bucketTotals.set(
      seg.payBucket,
      (bucketTotals.get(seg.payBucket) ?? 0) + seg.durationMinutes
    );
  }

  // Delete existing leave-type buckets for this timesheet
  await tx.overtimeBucket.deleteMany({
    where: { timesheetId, bucket: { in: LEAVE_BUCKET_VALUES } },
  });

  // Create new ones
  const bucketData = [...bucketTotals.entries()]
    .filter(([, mins]) => mins > 0)
    .map(([bucket, totalMinutes]) => ({
      timesheetId,
      bucket,
      totalMinutes,
    }));

  if (bucketData.length > 0) {
    await tx.overtimeBucket.createMany({ data: bucketData });
  }
}
