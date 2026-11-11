import Link from "next/link";
import { format } from "date-fns";
import { Badge, Card, LinkButton } from "@/components/ui";
import { parseUtcDate } from "@/lib/utils/date";
import type { TimeOffRow } from "@/lib/team/team-overview";

/**
 * Approved time off in the next 14 days, soonest first: who is off and when.
 * Team Overview and a supervisor's Dashboard draw the same card from the
 * same query (getTimeOffAhead), so the two can never disagree.
 */
export function TimeOffAheadCard({
  timeOff,
  now,
  linkClassName,
}: {
  timeOff: { rows: TimeOffRow[]; total: number; offToday: number };
  now: Date;
  /** The page's own style for the link in the card header. */
  linkClassName?: string;
}) {
  return (
    <Card
      title="Time Off Ahead"
      subtitle={
        timeOff.total === 0
          ? "Approved leave in the next 14 days"
          : `${plural(timeOff.offToday, "person", "people")} off today, ${plural(timeOff.total, "absence")} in the next 14 days`
      }
      actions={
        <LinkButton href="/supervisor/leave?tab=upcoming" hierarchy="tertiary" size="sm" className={linkClassName}>
          Team Calendar
        </LinkButton>
      }
    >
      {timeOff.rows.length === 0 ? (
        <Quiet>Nobody has approved time off in the next two weeks.</Quiet>
      ) : (
        <div className="flex flex-col">
          {timeOff.rows.map((r, i) => {
            const onNow = parseUtcDate(r.startDate) <= now;
            return (
              <div
                key={r.id}
                className={ROW}
                style={{ borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)" }}
              >
                <Avatar name={r.name} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate" style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)" }}>
                    {r.name}
                  </span>
                  <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                    {[r.leaveType, r.department].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex flex-none items-center gap-2">
                  {onNow && (
                    <Badge tone="info" size="sm">
                      Off today
                    </Badge>
                  )}
                  {/* "Off today" already says a one day absence's date; a
                      phone gives the name that room. */}
                  <span
                    className={`tabular whitespace-nowrap${onNow && dateRange(r.startDate, r.endDate) === dateRange(r.startDate, r.startDate) ? " ta-phone-hide" : ""}`}
                    style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                  >
                    {dateRange(r.startDate, r.endDate)}
                  </span>
                </span>
              </div>
            );
          })}
          {timeOff.total > timeOff.rows.length && (
            <Link
              href="/supervisor/leave?tab=upcoming"
              className="pt-2.5"
              style={{ font: "var(--type-body2)", color: "var(--text-accent)", textDecoration: "none" }}
            >
              {plural(timeOff.total - timeOff.rows.length, "more absence", "more absences")}
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

const ROW = "flex min-h-[48px] items-center gap-3 py-2";

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function dateRange(start: Date, end: Date): string {
  const s = parseUtcDate(start);
  const e = parseUtcDate(end);
  if (s.getTime() === e.getTime()) return format(s, "EEE MMM d");
  if (s.getMonth() === e.getMonth()) return `${format(s, "MMM d")} to ${format(e, "d")}`;
  return `${format(s, "MMM d")} to ${format(e, "MMM d")}`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full"
      style={{ background: "var(--surface-tertiary)", color: "var(--text-secondary)", font: "var(--weight-semibold) 12px/1 var(--font-sans)" }}
    >
      {initialsOf(name)}
    </span>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>{children}</p>;
}
