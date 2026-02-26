import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { format, eachDayOfInterval } from "date-fns";
import { TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/timesheet-state";
import { PUNCH_TYPE_LABEL } from "@/lib/state-machines/punch-state";
import { SegmentTimeline } from "@/components/time/segment-timeline";
import { formatMinutes } from "@/lib/utils/duration";
import { SubmitTimesheetButton } from "@/components/time/submit-timesheet-button";
import type { WorkSegment, Punch } from "@prisma/client";

export default async function TimesheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.employeeId) redirect("/dashboard");

  const timesheet = await db.timesheet.findUnique({
    where: { id },
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
  });

  if (!timesheet) notFound();
  if (timesheet.employeeId !== session.user.employeeId) redirect("/dashboard");

  // Date-only values from PostgreSQL arrive as UTC midnight Date objects.
  // Convert to local midnight so format() and getDay() use the intended calendar date.
  function parseUtcDate(d: Date): Date {
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  const days = eachDayOfInterval({
    start: parseUtcDate(timesheet.payPeriod.startDate),
    end: parseUtcDate(timesheet.payPeriod.endDate),
  });

  function segmentsForDay(day: Date): WorkSegment[] {
    return timesheet!.segments.filter(
      (s) =>
        format(parseUtcDate(s.segmentDate), "yyyy-MM-dd") === format(day, "yyyy-MM-dd")
    );
  }

  function punchesForDay(day: Date): Punch[] {
    return timesheet!.punches.filter(
      (p) =>
        format(p.roundedTime, "yyyy-MM-dd") === format(day, "yyyy-MM-dd")
    );
  }

  const bucketMap = Object.fromEntries(
    timesheet.overtimeBuckets.map((b) => [b.bucket, b.totalMinutes])
  );

  const SUMMARY_BUCKETS: { key: string; label: string; color: string }[] = [
    { key: "REG",        label: "Regular",    color: "text-zinc-900 dark:text-white" },
    { key: "OT",         label: "Overtime",   color: "text-amber-600 dark:text-amber-400" },
    { key: "DT",         label: "Double Time",color: "text-red-600 dark:text-red-400" },
    { key: "PTO",        label: "PTO",        color: "text-blue-600 dark:text-blue-400" },
    { key: "SICK",       label: "Sick",       color: "text-purple-600 dark:text-purple-400" },
    { key: "HOLIDAY",    label: "Holiday",    color: "text-green-600 dark:text-green-400" },
    { key: "FMLA",       label: "FMLA",       color: "text-zinc-500 dark:text-zinc-400" },
    { key: "BEREAVEMENT",label: "Bereavement",color: "text-zinc-500 dark:text-zinc-400" },
    { key: "JURY_DUTY",  label: "Jury Duty",  color: "text-zinc-500 dark:text-zinc-400" },
    { key: "MILITARY",   label: "Military",   color: "text-zinc-500 dark:text-zinc-400" },
    { key: "UNPAID",     label: "Unpaid",     color: "text-zinc-400 dark:text-zinc-500" },
  ];

  // Always show REG; show others only when non-zero
  const visibleBuckets = SUMMARY_BUCKETS.filter(
    (b) => b.key === "REG" || (bucketMap[b.key] ?? 0) > 0
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/time/timesheet"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ← My Timesheets
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
            {format(parseUtcDate(timesheet.payPeriod.startDate), "MMM d")} –{" "}
            {format(parseUtcDate(timesheet.payPeriod.endDate), "MMM d, yyyy")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Status:{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {TIMESHEET_STATUS_LABEL[timesheet.status]}
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {timesheet.status === "OPEN" && (
            <SubmitTimesheetButton timesheetId={timesheet.id} />
          )}
          {timesheet.exceptions.length > 0 && (
            <p className="text-sm text-amber-500">
              {timesheet.exceptions.length} unresolved exception(s)
            </p>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {visibleBuckets.map((b) => (
          <div
            key={b.key}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="text-xs text-zinc-500">{b.label}</p>
            <p className={`mt-1 text-xl font-bold ${b.color}`}>
              {formatMinutes(bucketMap[b.key] ?? 0)}
            </p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-green-500" /> Work
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-400" /> Meal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-blue-400" /> Break
        </span>
      </div>

      {/* Daily rows */}
      <div className="mt-4 flex flex-col gap-2">
        {days.map((day) => {
          const dayPunches = punchesForDay(day);
          const daySegments = segmentsForDay(day);
          const dayMinutes = daySegments
            .filter((s) => s.segmentType === "WORK")
            .reduce((a, s) => a + s.durationMinutes, 0);
          const isWeekend = [0, 6].includes(day.getDay());

          return (
            <div
              key={day.toISOString()}
              className={`rounded-xl border p-4 ${
                isWeekend
                  ? "border-zinc-100 bg-zinc-50/50 dark:border-zinc-900 dark:bg-zinc-900/40"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              }`}
            >
              <div className="flex items-center justify-between">
                <p
                  className={`text-sm font-medium ${
                    isWeekend
                      ? "text-zinc-400"
                      : "text-zinc-900 dark:text-white"
                  }`}
                >
                  {format(day, "EEE MMM d")}
                </p>
                {dayMinutes > 0 && (
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    {formatMinutes(dayMinutes)}
                  </p>
                )}
              </div>

              {daySegments.length > 0 && (
                <div className="mt-2">
                  <SegmentTimeline segments={daySegments} date={day} />
                </div>
              )}

              {dayPunches.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {dayPunches.map((p) => (
                    <span
                      key={p.id}
                      className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      {PUNCH_TYPE_LABEL[p.punchType]}{" "}
                      {format(p.roundedTime, "h:mm a")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
