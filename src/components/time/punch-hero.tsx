"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useCurrentTime } from "@/hooks/use-current-time";
import { format } from "date-fns";
import { recordPunch } from "@/actions/punch.actions";
import {
  PUNCH_STATE_LABEL,
  PUNCH_TYPE_LABEL,
  getAvailablePunchTypes,
  type PunchStateValue,
  type PunchTypeValue,
} from "@/lib/state-machines/labels";
import { Badge, Button } from "@/components/ui";

/**
 * The Punch Clock hero, as the portal design draws it: state badge, a 52px
 * live clock, the day's context, four figures, and the punch actions stacked
 * down the right.
 *
 * <p>Everything except the clock and the buttons is computed on the server and
 * passed in. Only the seconds need to tick, and re-deriving the week's hours in
 * the browser would be a second implementation of numbers payroll depends on.
 */

const TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  WORK: "success",
  MEAL: "warning",
  BREAK: "info",
  OUT: "neutral",
};

export interface PunchStat {
  label: string;
  value: string;
  note: string;
}

export function PunchHero({
  state,
  context,
  stats,
}: {
  state: PunchStateValue;
  /** "Tuesday, 15 September 2026 · Site 5903 · Shift 08:00 – 16:30" */
  context: string;
  stats: PunchStat[];
}) {
  const now = useCurrentTime();
  const router = useRouter();
  const [current, setCurrent] = useState<PunchStateValue>(state);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const available = getAvailablePunchTypes(current);

  function handlePunch(punchType: PunchTypeValue) {
    setError(null);
    startTransition(async () => {
      const result = await recordPunch({ punchType });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setCurrent(result.data.stateAfter as PunchStateValue);
      // The hours, the punch list and the week bars all move on a punch, and
      // they are rendered on the server — so ask for them again rather than
      // patching this component's copy and leaving the rest of the page stale.
      router.refresh();
    });
  }

  return (
    <div className="ta-card flex flex-wrap items-center gap-7 rounded-xl p-5">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="self-start">
          <Badge tone={TONE[current] ?? "neutral"} dot>
            {PUNCH_STATE_LABEL[current]}
          </Badge>
        </span>
        <span
          className="tabular"
          style={{
            font: "var(--weight-bold) 52px/56px var(--font-sans)",
            letterSpacing: "-0.04em",
            color: "var(--text-primary)",
          }}
        >
          {format(now, "hh:mm:ss a")}
        </span>
        <span style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>{context}</span>
      </div>

      <div className="grid min-w-[240px] flex-1 gap-5 [grid-template-columns:repeat(auto-fit,minmax(96px,1fr))]">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-0.5">
            <span className="wms-overline">{s.label}</span>
            <span
              className="tabular"
              style={{
                font: "var(--weight-semibold) 20px/26px var(--font-sans)",
                color: "var(--text-primary)",
              }}
            >
              {s.value}
            </span>
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{s.note}</span>
          </div>
        ))}
      </div>

      <div className="flex w-[220px] flex-none flex-col gap-2">
        {available.length === 0 ? (
          <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
            No actions available.
          </p>
        ) : (
          available.map((type, i) => (
            <Button
              key={type}
              fullWidth
              hierarchy={i === 0 ? "primary" : "secondary"}
              disabled={isPending}
              onClick={() => handlePunch(type)}
            >
              {PUNCH_TYPE_LABEL[type]}
            </Button>
          ))
        )}
        {error ? (
          <p style={{ margin: 0, font: "var(--type-caption1)", color: "var(--text-error)" }}>{error}</p>
        ) : (
          <p style={{ margin: 0, font: "var(--type-caption1)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            Stamped in site time · locked after payroll close.
          </p>
        )}
      </div>
    </div>
  );
}
