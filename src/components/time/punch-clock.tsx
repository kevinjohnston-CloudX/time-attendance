"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { useCurrentTime } from "@/hooks/use-current-time";
import { recordPunch } from "@/actions/punch.actions";
import {
  PUNCH_STATE_LABEL,
  PUNCH_TYPE_LABEL,
  getAvailablePunchTypes,
  type PunchStateValue,
  type PunchTypeValue,
} from "@/lib/state-machines/labels";

const STATE_COLORS: Record<PunchStateValue, string> = {
  OUT: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  WORK: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  MEAL: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  BREAK: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

interface PunchClockProps {
  initialState: PunchStateValue;
}

export function PunchClock({ initialState }: PunchClockProps) {
  const now = useCurrentTime();
  const [currentState, setCurrentState] = useState<PunchStateValue>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const available = getAvailablePunchTypes(currentState);

  function handlePunch(punchType: PunchTypeValue) {
    setError(null);
    startTransition(async () => {
      const result = await recordPunch({ punchType });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setCurrentState(result.data.stateAfter as PunchStateValue);
    });
  }

  return (
    <div className="rounded-2xl ta-card p-8">
      {/* Live clock */}
      <div className="text-center">
        <p className="text-5xl font-bold tabular-nums text-[var(--text-primary)]">
          {format(now, "hh:mm:ss a")}
        </p>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">
          {format(now, "EEEE, MMMM d, yyyy")}
        </p>
      </div>

      {/* Current state badge */}
      <div className="mt-6 flex justify-center">
        <span
          className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium ${STATE_COLORS[currentState]}`}
        >
          {PUNCH_STATE_LABEL[currentState]}
        </span>
      </div>

      {/* Punch buttons */}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {available.length === 0 ? (
          <p className="text-sm text-zinc-400">No actions available</p>
        ) : (
          available.map((pt) => (
            <button
              key={pt}
              onClick={() => handlePunch(pt)}
              disabled={isPending}
              className="rounded-lg bg-[var(--fill-accent)] px-6 py-2.5 text-sm font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--fill-accent-hover)] disabled:opacity-50"
            >
              {PUNCH_TYPE_LABEL[pt]}
            </button>
          ))
        )}
      </div>

      {error && (
        <p className="mt-4 text-center text-sm text-red-500">{error}</p>
      )}

      {isPending && (
        <p className="mt-4 text-center text-xs text-zinc-400">Recording…</p>
      )}
    </div>
  );
}
