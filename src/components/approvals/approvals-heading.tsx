"use client";

import { useRouter } from "@/components/layout/navigation-progress";
import { SegmentedControl } from "@/components/ui";

export type ApprovalsView = "leave" | "timecards";

/**
 * The Approvals page's title and its two queues (11/11): leave requests, and
 * supervisors' timecard edits waiting for HR. Each queue keeps its own place
 * in the address (?view=), so a link to either opens it.
 */
export function ApprovalsHeading({
  view,
  leaveCount,
  timecardCount,
  views,
}: {
  view: ApprovalsView;
  /** Leave requests waiting on this person, or null where they can't approve leave. */
  leaveCount: number | null;
  /** Timecard edits waiting for HR that this person can see, or null where they can't. */
  timecardCount: number | null;
  views: ApprovalsView[];
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2">
      <h1
        style={{
          margin: 0,
          fontSize: 30,
          lineHeight: "36px",
          fontWeight: "var(--weight-bold)",
          letterSpacing: "-0.02em",
          color: "var(--text-primary)",
        }}
      >
        Approvals
      </h1>
      {views.length > 1 && (
        <div>
          <SegmentedControl
            ariaLabel="What to approve"
            value={view}
            onChange={(next) => router.push(`/approvals?view=${next}`)}
            items={[
              { value: "leave", label: "Leave requests", ...(leaveCount !== null ? { count: leaveCount } : {}) },
              { value: "timecards", label: "Timecard edits", ...(timecardCount !== null ? { count: timecardCount } : {}) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
