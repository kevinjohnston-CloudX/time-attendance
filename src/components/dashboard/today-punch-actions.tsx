"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPunch } from "@/actions/punch.actions";
import {
  PUNCH_TYPE_LABEL,
  getAvailablePunchTypes,
  type PunchStateValue,
  type PunchTypeValue,
} from "@/lib/state-machines/labels";
import { Button } from "@/components/ui";

/**
 * The punch buttons on the dashboard's Today card.
 *
 * <p>The design puts the next punch action on the dashboard rather than only
 * on the Punch Clock page, because for most people the dashboard is the page
 * they already have open when it is time to go to lunch.
 *
 * <p>Shares {@link getAvailablePunchTypes} and the recordPunch action with the
 * full Punch Clock — which matters, because those encode the state machine.
 * A second copy would eventually allow a meal end without a meal start.
 *
 * <p>Refreshes on success so the hours, the punch list and the badge above it
 * all come from one render of the server's numbers, rather than this component
 * holding an optimistic state the rest of the card disagrees with.
 */
export function TodayPunchActions({ state }: { state: PunchStateValue }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const available = getAvailablePunchTypes(state);
  if (available.length === 0) return null;

  function handlePunch(punchType: PunchTypeValue) {
    setError(null);
    startTransition(async () => {
      const result = await recordPunch({ punchType });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {available.map((type, i) => (
          <Button
            key={type}
            /* The first available action is the expected one — clock out when
               working, clock in when out. The rest are secondary. */
            hierarchy={i === 0 ? "primary" : "secondary"}
            disabled={isPending}
            onClick={() => handlePunch(type)}
          >
            {PUNCH_TYPE_LABEL[type]}
          </Button>
        ))}
      </div>
      {error && (
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</p>
      )}
    </div>
  );
}
