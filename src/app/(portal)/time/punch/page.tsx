import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { format } from "date-fns";
import { PunchHero } from "@/components/time/punch-hero";
import { PunchHistoryTable } from "@/components/time/punch-history-table";
import { getToday } from "@/lib/dashboard/dashboard-data";
import { getUpcomingShifts, getWeek } from "@/lib/dashboard/punch-data";
import { parseUtcDate } from "@/lib/utils/date";
import { Badge, Card, PageHeader } from "@/components/ui";
import { CalendarPlus, ClipboardList, FileClock, Plane } from "lucide-react";
import type { PunchStateValue } from "@/lib/state-machines/labels";

/**
 * The Punch Clock, as the portal design lays it out: a hero card carrying the
 * clock and the day's figures, then today's punches beside the week, then the
 * schedule beside the things people go looking for straight afterwards.
 *
 * <p>The four follow-up links at the bottom are not filler. The three most
 * common actions after looking at this screen are reporting a missed punch,
 * requesting leave and checking a past period, and every one of them used to
 * mean going back to the sidebar and guessing which section it lived under.
 */
export default async function PunchPage() {
  const session = await auth();
  if (!session?.user?.employeeId) redirect("/dashboard");

  const { employeeId } = session.user;
  const tenantId = (session.user as { tenantId?: string }).tenantId;
  const now = new Date();

  const [today, employee, payPeriod] = await Promise.all([
    getToday(employeeId, now),
    db.employee.findUnique({
      where: { id: employeeId },
      select: { site: { select: { name: true } }, shift: { select: { name: true } } },
    }),
    tenantId
      ? db.payPeriod.findFirst({
          where: {
            tenantId,
            ruleSetId: { not: null },
            startDate: { lte: now },
            endDate: { gt: now },
            status: "OPEN",
          },
          select: { id: true, startDate: true, endDate: true },
        })
      : null,
  ]);

  const [week, upcomingShifts, periodSheet] = await Promise.all([
    getWeek(employeeId, now, today.workedMinutes),
    getUpcomingShifts(employeeId, now),
    payPeriod
      ? db.timesheet.findFirst({
          where: { employeeId, payPeriodId: payPeriod.id },
          select: { overtimeBuckets: { select: { bucket: true, totalMinutes: true } } },
        })
      : null,
  ]);

  const todayPunchRecords = await db.punch.findMany({
    where: {
      employeeId,
      isRejected: false,
      punchTime: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
    },
    orderBy: { punchTime: "asc" },
  });

  const periodMinutes = (periodSheet?.overtimeBuckets ?? []).reduce((n, b) => n + b.totalMinutes, 0);
  const periodOt = (periodSheet?.overtimeBuckets ?? []).find((b) => b.bucket === "OT")?.totalMinutes ?? 0;

  const context = [
    format(now, "EEEE, d MMMM yyyy"),
    employee?.site?.name,
    today.shift && `Shift ${today.shift.start} – ${today.shift.end}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const periodLabel = payPeriod
    ? `${format(parseUtcDate(payPeriod.startDate), "MMM d")} – ${format(parseUtcDate(payPeriod.endDate), "MMM d")}`
    : "No open period";

  const stats = [
    {
      label: "Today",
      value: (today.workedMinutes / 60).toFixed(2),
      note: today.state === "WORK" ? "still running" : "hours",
    },
    {
      label: "This week",
      value: (week.workedMinutes / 60).toFixed(2),
      note: `of ${(week.scheduledMinutes / 60).toFixed(2)} scheduled`,
    },
    {
      label: "Pay period",
      value: (periodMinutes / 60).toFixed(2),
      note: periodLabel,
    },
    {
      label: "Overtime",
      value: (periodOt / 60).toFixed(2),
      note: periodOt > 0 ? "this period" : "none this period",
    },
  ];

  const links = [
    {
      href: "/time/missed-punch",
      icon: FileClock,
      label: "Report a missed punch",
      detail: "Send a correction to your supervisor for approval.",
    },
    {
      href: "/leave/request",
      icon: Plane,
      label: "Request leave",
      detail: "Pick your days and send them for approval.",
    },
    {
      href: "/time/timesheet",
      icon: ClipboardList,
      label: "My timesheet",
      detail: "Check the hours for this pay period before it closes.",
    },
    {
      href: "/time/history",
      icon: CalendarPlus,
      label: "Punch history",
      detail: "Every punch, its source and whether it was approved.",
    },
  ];

  const scheduledToday = week.days.find((d) => d.isToday)?.scheduledMinutes ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Punch Clock" subtitle="Clock in, take your meal, clock out" />

      <PunchHero state={today.state as PunchStateValue} context={context} stats={stats} />

      <div className="grid gap-4 items-stretch [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(380px,46%)),1fr))]">
        <Card title="Today's Punches" subtitle={today.since} padding={0}>
          <PunchHistoryTable
            punches={todayPunchRecords}
            emptyTitle="Nothing punched today"
            emptyBody="Your first scan of the day will appear here."
          />
        </Card>

        <Card title="This Week" subtitle="Worked against scheduled hours">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-7 gap-2">
              {week.days.map((d) => {
                // Bars are drawn against the longest scheduled day, not against
                // each day's own target — otherwise a short Friday at 100% looks
                // taller than a full Monday at 90%.
                const scale = Math.max(
                  ...week.days.map((x) => Math.max(x.scheduledMinutes, x.workedMinutes)),
                  1,
                );
                const pct = Math.min(100, (d.workedMinutes / scale) * 100);
                const complete = d.workedMinutes >= d.scheduledMinutes && d.scheduledMinutes > 0;
                return (
                  <div key={d.label + d.date.getDate()} className="flex flex-col items-center gap-1.5">
                    <div
                      className="flex h-[104px] w-full items-end overflow-hidden rounded"
                      style={{ background: "var(--ta-track)" }}
                      title={`${(d.workedMinutes / 60).toFixed(2)} h worked · ${(d.scheduledMinutes / 60).toFixed(2)} h scheduled`}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: `${pct}%`,
                          background: complete
                            ? "var(--fill-accent)"
                            : "var(--wms-color-primary-400)",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        font: "var(--type-caption1)",
                        color: d.isToday ? "var(--text-accent)" : "var(--text-secondary)",
                        fontWeight: d.isToday ? "var(--weight-semibold)" : undefined,
                      }}
                    >
                      {d.label}
                    </span>
                    <span className="tabular" style={{ font: "var(--type-body2)" }}>
                      {d.workedMinutes > 0 ? (d.workedMinutes / 60).toFixed(2) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div
              className="flex flex-wrap items-center gap-4 pt-3"
              style={{
                borderTop: "1px solid var(--stroke-divider)",
                font: "var(--type-body2)",
                color: "var(--text-secondary)",
              }}
            >
              {[
                { label: "Complete", bg: "var(--fill-accent)" },
                { label: "In progress", bg: "var(--wms-color-primary-400)" },
                { label: "Scheduled", bg: "var(--ta-track)" },
              ].map((l) => (
                <span key={l.label} className="inline-flex items-center gap-1.5">
                  <span style={{ width: 10, height: 8, borderRadius: 2, background: l.bg }} />
                  {l.label}
                </span>
              ))}
              <span className="tabular ml-auto">
                {(week.workedMinutes / 60).toFixed(2)} of {(week.scheduledMinutes / 60).toFixed(2)} h
                scheduled
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 items-stretch [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(380px,46%)),1fr))]">
        <Card
          title="Upcoming Shifts"
          subtitle={
            upcomingShifts.length > 0
              ? "Next five scheduled days"
              : scheduledToday > 0
                ? "Nothing scheduled after today"
                : "No shift assigned"
          }
        >
          <div className="flex flex-col">
            {upcomingShifts.length === 0 ? (
              <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
                No upcoming shifts on your schedule.
              </p>
            ) : (
              upcomingShifts.map((u) => (
                <div
                  key={u.key}
                  className="flex items-center gap-3 py-2"
                  style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                >
                  <span
                    className="w-[92px] flex-none"
                    style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)" }}
                  >
                    {u.day}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                  >
                    {u.shift}
                  </span>
                  <span className="tabular flex-none" style={{ font: "var(--type-body2)" }}>
                    {u.hours}
                  </span>
                  <Badge tone={u.tone} size="sm">
                    {u.note}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card title="Need Something Else?" subtitle="Common follow-ups from this screen">
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,45%)),1fr))]">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="ta-hub-card flex items-start gap-2.5 rounded-lg p-3"
                style={{ border: "1px solid var(--stroke-secondary)", background: "var(--surface-card)" }}
              >
                <l.icon className="mt-px h-[18px] w-[18px] flex-none" style={{ color: "var(--icon-accent)" }} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
                    {l.label}
                  </span>
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                    {l.detail}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
