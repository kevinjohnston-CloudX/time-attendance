"use client";

import { useState } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday, format, parseISO,
  addMonths, subMonths, isWithinInterval, startOfDay, endOfDay,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { leaveTone, type BadgeTone } from "@/components/ui";

/**
 * The month view of your own leave, as the design's calendar section draws it:
 * plain overline day names, a grid of bordered cells, and a legend under a
 * divider.
 *
 * <p>A day's colour comes from {@link leaveTone}, the same helper that colours
 * the status pill in the list above it, so a Pending row and a Pending day can
 * never disagree. The map below turns a *tone* into surface tokens — it is not
 * a second opinion about what a status means, which is what the seven
 * hand-written status→colour maps this replaced had become.
 */

// Dates from the server are YYYY-MM-DD strings. parseISO treats them as local midnight.
function parseLeaveDate(d: string): Date {
  return parseISO(d);
}

type ToneSurface = { bg: string; fg: string; line: string };

/** Tone → the surface trio. Partial: leaveTone only ever returns these four. */
const TONE_SURFACE: Partial<Record<BadgeTone, ToneSurface>> = {
  success: { bg: "var(--surface-success)", fg: "var(--text-success)", line: "var(--stroke-success)" },
  warning: { bg: "var(--surface-warning)", fg: "var(--text-warning)", line: "var(--stroke-warning)" },
  error:   { bg: "var(--surface-error)",   fg: "var(--text-error)",   line: "var(--stroke-error)" },
  info:    { bg: "var(--surface-info)",    fg: "var(--text-accent)",  line: "var(--stroke-accent-focus)" },
};

const NEUTRAL_SURFACE: ToneSurface = {
  bg: "var(--surface-secondary)",
  fg: "var(--text-secondary)",
  line: "var(--stroke-divider)",
};

function surfaceFor(status: string): ToneSurface {
  return TONE_SURFACE[leaveTone(status)] ?? NEUTRAL_SURFACE;
}

/**
 * Which request wins a day that two of them cover.
 *
 * <p>Settled beats unsettled: if a day is both approved and pending you are
 * off that day, and drawing it as pending would have you turning up.
 */
const STATUS_PRIORITY: Record<string, number> = {
  APPROVED: 1, POSTED: 2, PENDING_HR: 3, PENDING: 4, DRAFT: 5, REJECTED: 6, CANCELLED: 7,
};

/**
 * One entry per colour the grid can actually draw.
 *
 * <p>leaveTone() puts APPROVED and POSTED on the same success surface, so
 * listing them as two swatches would print the identical square beside two
 * labels and imply the calendar tells them apart — it does not, and the table
 * above is where that distinction lives. PENDING_HR is its own colour and is
 * listed for the same reason: a legend that leaves out a colour on the grid is
 * worse than no legend.
 */
const LEGEND = [
  { status: "APPROVED",   label: "Approved or posted" },
  { status: "PENDING",    label: "Pending Supervisor" },
  { status: "PENDING_HR", label: "Pending HR" },
  { status: "REJECTED",   label: "Rejected" },
];

type LeaveRequest = {
  id: string;
  status: string;
  startDate: string | Date;
  endDate: string | Date;
  leaveType: { name: string };
  durationMinutes: number;
};

export function LeaveCalendar({ requests, className }: { requests: LeaveRequest[]; className?: string }) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentMonth)),
    end:   endOfWeek(endOfMonth(currentMonth)),
  });

  const weekCount = days.length / 7;

  function requestForDay(day: Date): LeaveRequest | null {
    const matching = requests.filter((req) => {
      if (req.status === "CANCELLED") return false;
      const s = startOfDay(parseLeaveDate(req.startDate as string));
      const e = endOfDay(parseLeaveDate(req.endDate as string));
      return isWithinInterval(day, { start: s, end: e });
    });
    if (matching.length === 0) return null;
    return matching.sort(
      (a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)
    )[0];
  }

  return (
    <div className={`flex flex-col gap-2.5${className ? ` ${className}` : ""}`}>
      <div className="flex shrink-0 items-center gap-1.5">
        <NavButton label="Previous month" onClick={() => setCurrentMonth((m) => subMonths(m, 1))}>
          <ChevronLeft className="h-[15px] w-[15px]" />
        </NavButton>
        <span
          className="min-w-[150px] text-center"
          style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}
        >
          {format(currentMonth, "MMMM yyyy")}
        </span>
        <NavButton label="Next month" onClick={() => setCurrentMonth((m) => addMonths(m, 1))}>
          <ChevronRight className="h-[15px] w-[15px]" />
        </NavButton>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="wms-overline py-1.5 text-center">
            {d}
          </div>
        ))}
      </div>

      <div
        className="grid flex-1 grid-cols-7 gap-1"
        style={{ gridTemplateRows: `repeat(${weekCount}, minmax(42px, 1fr))` }}
      >
        {days.map((day) => {
          const req     = requestForDay(day);
          const inMonth = isSameMonth(day, currentMonth);
          // A leave day outside the displayed month is dimmed rather than
          // uncoloured: the run has to stay readable as one block when it
          // crosses a month boundary.
          const booked  = req && inMonth ? surfaceFor(req.status) : null;
          const today   = isToday(day);

          return (
            <div
              key={day.toISOString()}
              title={req ? `${req.leaveType.name} · ${(req.durationMinutes / 60).toFixed(2)} h` : undefined}
              className="tabular flex items-center justify-center rounded-md"
              style={{
                border: `1px solid ${booked ? booked.line : "var(--stroke-divider)"}`,
                background: booked ? booked.bg : "var(--surface-secondary)",
                color: booked ? booked.fg : "var(--text-secondary)",
                opacity: inMonth ? 1 : 0.35,
                font: "var(--type-body2)",
                fontWeight: booked ? "var(--weight-medium)" : undefined,
              }}
            >
              {today ? (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full"
                  style={{
                    background: "var(--fill-accent)",
                    color: "var(--text-on-accent)",
                    fontWeight: "var(--weight-bold)",
                  }}
                >
                  {format(day, "d")}
                </span>
              ) : (
                format(day, "d")
              )}
            </div>
          );
        })}
      </div>

      <div
        className="flex shrink-0 flex-wrap gap-x-4 gap-y-2 pt-3"
        style={{ borderTop: "1px solid var(--stroke-divider)" }}
      >
        {LEGEND.map(({ status, label }) => {
          const s = surfaceFor(status);
          return (
            <span
              key={status}
              className="inline-flex items-center gap-1.5"
              style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: s.bg,
                  border: `1px solid ${s.line}`,
                }}
              />
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** The 26px bordered square the design uses to step months. */
function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="ta-field inline-flex h-[26px] w-[26px] items-center justify-center rounded-md"
      style={{
        border: "1px solid var(--stroke-secondary)",
        background: "var(--surface-card)",
        color: "var(--icon-secondary)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
