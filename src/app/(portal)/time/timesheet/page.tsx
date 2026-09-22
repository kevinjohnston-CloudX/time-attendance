import { redirect } from "next/navigation";
import { addDays, format } from "date-fns";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseUtcDate } from "@/lib/utils/date";
import { LinkButton, PageHeader } from "@/components/ui";
import { SubmitTimesheetButton } from "@/components/time/submit-timesheet-button";
import { TimesheetViewer } from "@/components/time/timesheet-viewer";
import {
  TIMESHEET_STATUS_LABEL,
  type TimesheetStatusValue,
} from "@/lib/state-machines/labels";

/**
 * My Timesheet, as the portal design's timecard grid (Template C).
 *
 * <p>The queries are untouched: every one of this employee's timesheets for
 * the period picker, then the full detail of the selected one. What changed is
 * the shape handed to the client — the grid needs the meal punches and the
 * supervisor's return note, both of which the existing `include` already
 * fetched and the old two-pane layout simply never showed.
 *
 * <p>The period and its state live in the page header rather than inside the
 * panel. The grid below shows one week at a time, so a row reading "8.00" has
 * no period attached to it, and the period is the single thing that decides
 * whether an hours figure is the right one.
 */
export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ payPeriodId?: string }>;
}) {
  const { payPeriodId } = await searchParams;
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

  if (!selectedTs && !payPeriodId) {
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
          segments: {
            orderBy: { startTime: "asc" },
            include: {
              leaveRequest: { include: { leaveType: { select: { name: true } } } },
              payCode: { select: { code: true, label: true } },
            },
          },
          dayReasons: { include: { reasonCode: { select: { code: true, label: true } } } },
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
        // Already on the row the `include` above returned. The banner needs it:
        // a returned timesheet goes back to OPEN, so without the note the only
        // signal that a supervisor sent it back is that it is editable again.
        rejectionNote: rawDetail.rejectionNote,
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
          leaveTypeName: s.leaveRequest?.leaveType?.name ?? null,
          payCode: s.payCode ? { code: s.payCode.code, label: s.payCode.label } : null,
        })),
        dayReasons: rawDetail.dayReasons.map((dr) => ({
          segmentDate: dr.segmentDate.toISOString(),
          reasonCode: { code: dr.reasonCode.code, label: dr.reasonCode.label },
        })),
        overtimeBuckets: rawDetail.overtimeBuckets.map((b) => ({
          bucket: b.bucket,
          totalMinutes: b.totalMinutes,
        })),
        exceptionCount: rawDetail.exceptions.length,
      }
    : null;

  // The end date is stored exclusive, so the last day people worked is the day
  // before it — printing the raw value dates every period a day long.
  const subtitle = selectedTs
    ? `Pay period ${format(parseUtcDate(selectedTs.payPeriod.startDate), "MMM d")} – ${format(
        addDays(parseUtcDate(selectedTs.payPeriod.endDate), -1),
        "MMM d, yyyy",
      )} · ${TIMESHEET_STATUS_LABEL[selectedTs.status as TimesheetStatusValue] ?? selectedTs.status}`
    : timesheets.length === 0
      ? "Your first punch opens a timesheet"
      : "No timesheet for that pay period";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My Timesheet"
        subtitle={subtitle}
        actions={
          <>
            <LinkButton href="/time/missed-punch" hierarchy="secondary">
              Report Missed Punch
            </LinkButton>
            {/* Same condition the detail pane used before: submitting is only
                offered while the sheet is still yours to change.

                md, because this is a page header: the component defaults to sm
                for the dashboard card it also appears in, and left alone the
                primary action would stand 24px next to a 32px secondary. */}
            {serializedDetail?.status === "OPEN" && (
              <SubmitTimesheetButton timesheetId={serializedDetail.timesheetId} size="md" />
            )}
          </>
        }
      />

      <TimesheetViewer
        timesheets={serializedTimesheets}
        selectedPayPeriodId={selectedTs?.payPeriod.id ?? null}
        detail={serializedDetail}
      />
    </div>
  );
}
