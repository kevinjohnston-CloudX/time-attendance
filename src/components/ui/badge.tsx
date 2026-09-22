import type { CSSProperties, ReactNode } from "react";

/**
 * CloudX WMS Badge — the status pill used in tables and headers.
 *
 * <p>Tone values and their three weights (surface / border / text) are taken
 * verbatim from the design system bundle, so a SUBMITTED pill here is the
 * same green as a SUBMITTED pill anywhere else in the product.
 */

export type BadgeTone = "neutral" | "success" | "warning" | "error" | "info" | "purple";

const TONES: Record<BadgeTone, { soft: [string, string]; solid: [string, string]; dot: string; line: string }> = {
  neutral: {
    soft: ["var(--wms-color-gray-100)", "var(--wms-color-gray-800)"],
    solid: ["var(--wms-color-gray-600)", "#fff"],
    dot: "var(--wms-color-gray-400)",
    line: "var(--stroke-default)",
  },
  success: {
    soft: ["var(--wms-color-emerald-50)", "var(--wms-color-emerald-800)"],
    solid: ["var(--wms-color-emerald-600)", "#fff"],
    dot: "var(--wms-color-emerald-500)",
    line: "var(--wms-color-emerald-200)",
  },
  warning: {
    soft: ["var(--wms-color-amber-50)", "var(--wms-color-amber-800)"],
    solid: ["var(--wms-color-amber-500)", "#fff"],
    dot: "var(--wms-color-amber-500)",
    line: "var(--wms-color-amber-200)",
  },
  error: {
    soft: ["var(--wms-color-red-50)", "var(--wms-color-red-800)"],
    solid: ["var(--wms-color-red-600)", "#fff"],
    dot: "var(--wms-color-red-500)",
    line: "var(--wms-color-red-200)",
  },
  info: {
    soft: ["var(--wms-color-primary-50)", "var(--wms-color-primary-800)"],
    solid: ["var(--wms-color-primary-600)", "#fff"],
    dot: "var(--wms-color-primary-500)",
    line: "var(--wms-color-primary-200)",
  },
  purple: {
    soft: ["var(--wms-color-violet-50)", "var(--wms-color-violet-800)"],
    solid: ["var(--wms-color-violet-600)", "#fff"],
    dot: "var(--wms-color-violet-500)",
    line: "var(--wms-color-violet-200)",
  },
};

export function Badge({
  children,
  tone = "neutral",
  variant = "soft",
  dot = false,
  size = "md",
  style,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  variant?: "soft" | "solid" | "outline";
  dot?: boolean;
  size?: "sm" | "md";
  style?: CSSProperties;
}) {
  const t = TONES[tone];
  let bg: string;
  let fg: string;
  let border = "1px solid transparent";

  if (variant === "solid") {
    [bg, fg] = t.solid;
  } else if (variant === "outline") {
    bg = "transparent";
    fg = t.soft[1];
    border = `1px solid ${t.line}`;
  } else {
    [bg, fg] = t.soft;
    border = `1px solid ${t.line}`;
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: size === "sm" ? "1px 7px" : "4px 11px",
        height: size === "sm" ? 18 : 24,
        boxSizing: "border-box",
        background: bg,
        color: fg,
        border,
        borderRadius: "var(--radius-full)",
        font:
          size === "sm"
            ? "var(--weight-medium) 11px/16px var(--font-sans)"
            : "var(--weight-medium) 12px/16px var(--font-sans)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: variant === "solid" ? "currentColor" : t.dot,
            flex: "none",
          }}
        />
      )}
      {children}
    </span>
  );
}

/**
 * What colour a domain value carries, answered once.
 *
 * <p>Before these existed the answer was spread over seven hand-written class
 * maps in six files, and they had drifted: SUBMITTED was sky on the timecard
 * screen and blue on the timesheet screen, and two of the maps had no
 * dark-mode variants at all, so their pills were dark text on a light fill
 * whenever someone switched theme.
 *
 * <p>Tone is chosen by severity, not by variety. A screen where four of seven
 * values each have their own hue is a screen where nothing stands out.
 */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "APPROVED":
    case "PAYROLL_APPROVED":
    case "LOCKED":
    case "CLOSED":
    case "RESOLVED":
    case "ACTIVE":
      return "success";
    case "SUBMITTED":
    case "PENDING":
    case "SUP_APPROVED":
    case "IN_PROGRESS":
      return "info";
    case "OPEN":
    case "DRAFT":
    // Settled states, not problems. These fell through to the default and came
    // out amber, so every deactivated tenant, site, role and rule set wore a
    // "needs attention" pill — on the super-admin screens that is most of the
    // list, which is how a warning colour stops meaning anything.
    case "INACTIVE":
    case "TERMINATED":
    case "ARCHIVED":
    case "DISABLED":
      return "neutral";
    case "REJECTED":
    case "CANCELLED":
    case "FAILED":
      return "error";
    default:
      // Deliberately amber: an unmapped status is one nobody has thought about,
      // and it should look like something to look at rather than blend in.
      return "warning";
  }
}

/**
 * Where a punch leaves somebody: on the clock, at lunch, gone home.
 *
 * <p>Not a status in the approval sense, which is why it is separate from
 * {@link statusTone} — "OUT" is the normal end of a shift, and putting it
 * through the status scale would colour a finished day as though something had
 * gone wrong with it.
 */
export function punchTone(state: string): BadgeTone {
  switch (state) {
    case "WORK":
      return "success";
    case "MEAL":
      return "warning";
    case "BREAK":
      return "info";
    default:
      return "neutral";
  }
}

/**
 * Where a pay period is in its life.
 *
 * <p>LOCKED is neutral rather than green on purpose. A locked period is not an
 * achievement, it is a period nobody can edit any more, and the screens that
 * show it are the ones where somebody is looking for a period they still can.
 */
export function payPeriodTone(status: string): BadgeTone {
  switch (status) {
    case "OPEN":
      return "info";
    case "READY":
      return "warning";
    case "LOCKED":
      return "neutral";
    default:
      return "warning";
  }
}

/**
 * Exception severity.
 *
 * <p>A missing punch is the only one of these that stops a timecard being paid
 * correctly, so it is the only one in red. Everything else is something to look
 * at, and a late clock-in is information rather than a problem.
 */
export function exceptionTone(exceptionType: string): BadgeTone {
  switch (exceptionType) {
    case "MISSING_PUNCH":
      return "error";
    case "CONSECUTIVE_DAYS":
      return "purple";
    case "ABSENT":
      return "neutral";
    case "LATE_IN":
    case "EARLY_OUT":
      return "info";
    default:
      return "warning";
  }
}

/** Where a leave request sits: waiting on someone, settled, or refused. */
export function leaveTone(status: string): BadgeTone {
  switch (status) {
    case "APPROVED":
    case "POSTED":
      return "success";
    case "PENDING":
      return "warning";
    case "PENDING_HR":
      return "info";
    case "REJECTED":
      return "error";
    default:
      return "neutral";
  }
}
