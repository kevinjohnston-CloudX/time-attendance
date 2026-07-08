import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { TIMESHEET_STATUS_LABEL, PUNCH_TYPE_LABEL } from "@/lib/state-machines/labels";
import { formatMinutes } from "@/lib/utils/duration";
import { format, eachDayOfInterval } from "date-fns";
import { parseUtcDate } from "@/lib/utils/date";
import { SegmentTimeline } from "@/components/time/segment-timeline";
import { SubmitTimesheetButton } from "@/components/time/submit-timesheet-button";
import type { WorkSegment, Punch } from "@prisma/client";

const STATUS_BADGE: Record<string, string> = {
  OPEN:             "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  SUBMITTED:        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  SUP_APPROVED:     "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  PAYROLL_APPROVED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  LOCKED:           "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

const SUMMARY_BUCKETS = [
  { key: "REG",         label: "Regular",     color: "text-zinc-900 dark:text-white" },
  { key: "OT",          label: "Overtime",    color: "text-amber-600 dark:text-amber-400" },
  { key: "DT",          label: "Double Time", color: "text-red-600 dark:text-red-400" },
  { key: "PTO",         label: "PTO",         color: "text-blue-600 dark:text-blue-400" },
  { key: "SICK",        label: "Sick",        color: "text-purple-600 dark:text-purple-400" },
  { key: "HOLIDAY",     label: "Holiday",     color: "text-green-600 dark:text-green-400" },
  { key: "FMLA",        label: "FMLA",        color: "text-zinc-500 dark:text-zinc-400" },
  { key: "BEREAVEMENT", label: "Bereavement", color: "text-zinc-500 dark:text-zinc-400" },
  { key: "JURY_DUTY",   label: "Jury Duty",   color: "text-zinc-500 dark:text-zinc-400" },
  { key: "MILITARY",    label: "Military",    color: "text-zinc-500 dark:text-zinc-400" },
  { key: "UNPAID",      label: "Unpaid",      color: "text-zinc-400 dark:text-zinc-500" },
];

export default async function TimesheetListPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id: selectedId } = await searchParams;
  const session = await auth();
  if (!session?.user?.employeeId) redirect("/dashboard");

  const timesheets = await db.timesheet.findMany({
    where: { employeeId: session.user.employeeId },
    include: { payPeriod: true, overtimeBuckets: true },
    orderBy: { payPeriod: { startDate: "desc" } },
  });

  async function getTimesheetDetail(id: string) {
    const found = await db.timesheet.findUnique({
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
    return found && found.employeeId === session!.user!.employeeId ? found : null;
  }

  let detail: Awaited<ReturnType<typeof getTimesheetDetail>> = null;

  if (selectedId) {
    detail = await getTimesheetDetail(selectedId);
  }

  return (
    <div className="flex items-start gap-0 -mx-6 -my-8 h-[calc(100vh-0px)]">
      {/* ── Left panel: list ─────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-800 sticky top-0 h-screen overflow-y-auto">
        <div className="px-4 pt-6 pb-3">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">My Timesheets</h1>
        </div>

        {timesheets.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-zinc-400">
            No timesheets yet. Timesheets are created automatically when you punch in.
          </p>
        )}

        <div className="flex flex-col">
          {timesheets.map((ts) => {
            const totalMinutes = ts.overtimeBuckets.reduce((a, b) => a + b.totalMinutes, 0);
            const isSelected = ts.id === selectedId;
            return (
              <Link
                key={ts.id}
                href={`/time/timesheet?id=${ts.id}`}
                className={`flex flex-col border-b border-zinc-100 px-4 py-3 transition-colors dark:border-zinc-800 ${
                  isSelected
                    ? "bg-blue-50 dark:bg-blue-950/20 border-l-2 border-l-blue-500"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                    {format(ts.payPeriod.startDate, "MMM d")} –{" "}
                    {format(ts.payPeriod.endDate, "MMM d, yyyy")}
                  </p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[ts.status]}`}>
                    {TIMESHEET_STATUS_LABEL[ts.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {formatMinutes(totalMinutes)} total
                </p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Right panel: detail ───────────────────────────────── */}
      <div className="flex-1 overflow-y-auto h-screen px-6 py-6">
        {!detail ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-400">Select a timesheet to view details</p>
          </div>
        ) : (() => {
          const days = eachDayOfInterval({
            start: parseUtcDate(detail.payPeriod.startDate),
            end: parseUtcDate(detail.payPeriod.endDate),
          });

          function segmentsForDay(day: Date): WorkSegment[] {
            return detail!.segments.filter(
              (s) => format(parseUtcDate(s.segmentDate), "yyyy-MM-dd") === format(day, "yyyy-MM-dd")
            );
          }

          function punchesForDay(day: Date): Punch[] {
            return detail!.punches.filter(
              (p) => format(p.roundedTime, "yyyy-MM-dd") === format(day, "yyyy-MM-dd")
            );
          }

          const bucketMap = Object.fromEntries(
            detail.overtimeBuckets.map((b) => [b.bucket, b.totalMinutes])
          );
          const visibleBuckets = SUMMARY_BUCKETS.filter(
            (b) => b.key === "REG" || (bucketMap[b.key] ?? 0) > 0
          );

          return (
            <div>
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
                    {format(parseUtcDate(detail.payPeriod.startDate), "MMM d")} –{" "}
                    {format(parseUtcDate(detail.payPeriod.endDate), "MMM d, yyyy")}
                  </h2>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`rounded-full px-3 py-0.5 text-xs font-medium ${STATUS_BADGE[detail.status]}`}>
                      {TIMESHEET_STATUS_LABEL[detail.status]}
                    </span>
                    {detail.exceptions.length > 0 && (
                      <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        {detail.exceptions.length} exception{detail.exceptions.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
                {detail.status === "OPEN" && (
                  <SubmitTimesheetButton timesheetId={detail.id} />
                )}
              </div>

              {/* Summary tiles */}
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                        <p className={`text-sm font-medium ${isWeekend ? "text-zinc-400" : "text-zinc-900 dark:text-white"}`}>
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
        })()}
      </div>
    </div>
  );
}
