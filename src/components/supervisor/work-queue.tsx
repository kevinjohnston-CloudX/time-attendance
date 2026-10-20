import Link from "next/link";
import { CalendarClock, CalendarDays, Check, ChevronRight, TriangleAlert } from "lucide-react";
import type { TeamQueues } from "@/lib/team/team-overview";

/**
 * The work queue: one row per thing waiting on a decision, with its count and
 * where it is decided. Drawn by Team Overview and by Approvals, from one
 * definition, so the two screens can never disagree about what is waiting.
 */

export type WorkQueueRow = {
  key: string;
  icon: React.ReactNode;
  label: string;
  detail: string;
  /** Shorter words for a phone's one line row. */
  phoneLabel: string;
  phoneDetail: string;
  count: number;
  href: string;
  /** Whether this viewer can act on the count; if not it is information and stays grey. */
  actionable: boolean;
  tone: "warning" | "error";
};

/**
 * The rows for this viewer. `isPayroll` is payroll and HR, who see every team
 * and make the HR decision; a supervisor sees their own team, and leave that
 * is already with HR is shown to them but is not theirs to decide.
 */
export function workQueueRows(queues: TeamQueues, isPayroll: boolean): WorkQueueRow[] {
  return [
    {
      key: "exceptions",
      icon: <TriangleAlert className="h-[17px] w-[17px]" />,
      label: "Exceptions to resolve",
      detail: "Missing punches and rule breaks that keep hours wrong until they are fixed",
      phoneLabel: "Exceptions",
      phoneDetail: "Missing punches and rule breaks",
      count: queues.exceptions,
      href: "/supervisor/exceptions",
      actionable: true,
      tone: "error",
    },
    {
      key: "leave",
      icon: <CalendarClock className="h-[17px] w-[17px]" />,
      label: "Leave requests to decide",
      detail: isPayroll ? "Waiting on a supervisor's decision" : "Time off your team has asked for",
      phoneLabel: "Leave to decide",
      phoneDetail: isPayroll ? "Waiting on a supervisor" : "Time off your team asked for",
      count: queues.leavePending,
      href: "/supervisor/leave?tab=pending",
      actionable: true,
      tone: "warning",
    },
    {
      key: "hr",
      icon: <CalendarDays className="h-[17px] w-[17px]" />,
      label: isPayroll ? "Leave awaiting HR approval" : "Leave with HR",
      detail: isPayroll
        ? "Approved on the floor and waiting on the HR decision"
        : "You approved these, and HR makes the final decision",
      phoneLabel: isPayroll ? "Leave waiting on HR" : "Leave with HR",
      phoneDetail: isPayroll ? "Approved on the floor" : "HR makes the final decision",
      count: queues.leaveWithHr,
      href: "/supervisor/leave?tab=hr-pending",
      actionable: isPayroll,
      tone: "warning",
    },
  ];
}

/** The rows, as one divided list for the inside of a Card. */
export function WorkQueueList({ rows }: { rows: WorkQueueRow[] }) {
  return (
    <div className="flex flex-col" style={{ gap: 1, background: "var(--stroke-divider)" }}>
      {rows.map((r) => (
        <Link
          key={r.key}
          href={r.href}
          className="ta-hoverable grid min-h-[64px] items-center gap-x-3.5 px-4 py-3 [grid-template-columns:32px_minmax(0,1fr)_auto_18px]"
          style={{ background: "var(--surface-card)", color: "var(--text-primary)", textDecoration: "none" }}
        >
          <span
            className="inline-flex items-center justify-center"
            style={{ width: 32, height: 32, borderRadius: 9, background: "var(--surface-info)", color: "var(--icon-accent)" }}
          >
            {r.icon}
          </span>
          <span className="ta-desktop-only">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)" }}>{r.label}</span>
              <span className="ta-queue-detail" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                {r.detail}
              </span>
            </span>
          </span>
          {/* A phone's row: the queue's short name and one line under it. */}
          <span className="ta-phone-only">
            <span className="ta-list-text">
              <span className="ta-list-title">{r.phoneLabel}</span>
              <span className="ta-list-sub" style={{ whiteSpace: "normal" }}>
                {r.phoneDetail}
              </span>
            </span>
          </span>
          <CountPill count={r.count} actionable={r.actionable} tone={r.tone} />
          <ChevronRight className="h-[17px] w-[17px]" style={{ color: "var(--icon-tertiary)" }} />
        </Link>
      ))}
    </div>
  );
}

/**
 * The count at the end of a work queue row. Tinted only when there is
 * something this viewer can act on; a clear queue says so in green instead of
 * showing a zero somebody has to interpret.
 */
function CountPill({ count, actionable, tone }: { count: number; actionable: boolean; tone: "warning" | "error" }) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 24,
    minWidth: 32,
    justifyContent: "center",
    padding: "0 9px",
    borderRadius: 999,
    whiteSpace: "nowrap" as const,
    font: "var(--weight-semibold) 13px/18px var(--font-sans)",
    fontVariantNumeric: "tabular-nums",
  };
  if (count === 0) {
    return (
      <span style={{ ...base, background: "var(--surface-success)", color: "var(--text-success)", boxShadow: "inset 0 0 0 1px var(--stroke-success)" }}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Clear
      </span>
    );
  }
  if (!actionable) {
    return <span style={{ ...base, background: "var(--ta-track)", color: "var(--text-secondary)" }}>{count.toLocaleString()}</span>;
  }
  const t =
    tone === "error"
      ? { bg: "var(--surface-error)", fg: "var(--text-error)", line: "var(--stroke-error)" }
      : { bg: "var(--surface-warning)", fg: "var(--text-warning)", line: "var(--stroke-warning)" };
  return (
    <span style={{ ...base, background: t.bg, color: t.fg, boxShadow: `inset 0 0 0 1px ${t.line}` }}>
      {count.toLocaleString()}
    </span>
  );
}
