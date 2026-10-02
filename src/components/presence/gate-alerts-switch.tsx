"use client";

import { useState, useTransition } from "react";
import { BellOff, BellRing } from "lucide-react";
import { format } from "date-fns";
import { Button, ConfirmDialog } from "@/components/ui";
import { setGateAlerts } from "@/actions/gate-refusals.actions";

/**
 * The gate alert switch for the building on screen, in the Live Attendance
 * header, for System Admins only (the page passes it nothing for anybody
 * else, and the action refuses them).
 *
 * <p>A plain button that says what it will do ("Turn off gate alerts"),
 * because one click changes what loss prevention sees in that building. It
 * asks first, in a sentence naming the building, and only then saves. Other
 * screens on that building follow within seconds through the page's pulse.
 * Each building keeps its own setting, so the dialog also says where else the
 * alert is on.
 */
export function GateAlertsSwitch({
  site,
  onElsewhere,
  onChanged,
}: {
  /** The building on screen, and when its alert was last turned on (null while off). */
  site: { id: string; name: string; onSince: string | null };
  /** The other buildings where the alert is on, by name. */
  onElsewhere: string[];
  onChanged: (onSince: string | null) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onSince = site.onSince;
  const on = onSince !== null;

  const confirm = () => {
    setError(null);
    start(async () => {
      const result = await setGateAlerts({ siteId: site.id, on: !on });
      if (!result.success) {
        setError(
          result.error === "FORBIDDEN"
            ? "Only System Admins can change gate alerts."
            : result.error === "NOT_FOUND"
              ? "This building is no longer on your list. Reload the page and try again."
              : result.error,
        );
        return;
      }
      setAsking(false);
      onChanged(result.data.onSince);
    });
  };

  const elsewhere =
    onElsewhere.length === 0
      ? "Gate alerts are off in every other building."
      : `Gate alerts are also on at ${onElsewhere.join(", ")}.`;

  return (
    <>
      <Button
        hierarchy="secondary"
        leadingIcon={on ? <BellOff className="h-4 w-4" aria-hidden="true" /> : <BellRing className="h-4 w-4" aria-hidden="true" />}
        onClick={() => {
          setError(null);
          setAsking(true);
        }}
      >
        {on ? "Turn off gate alerts" : "Turn on gate alerts"}
      </Button>
      {asking && (
        <ConfirmDialog
          title={on ? `Turn off gate alerts at ${site.name}?` : `Turn on gate alerts at ${site.name}?`}
          confirmLabel={on ? "Turn off gate alerts" : "Turn on gate alerts"}
          pendingLabel={on ? "Turning off…" : "Turning on…"}
          tone={on ? "warning" : "info"}
          pending={pending}
          error={error}
          onConfirm={confirm}
          onCancel={() => {
            if (!pending) setAsking(false);
          }}
        >
          {onSince ? (
            <>
              <p className="m-0">
                Nobody gets the gate alert pop up at {site.name} until an admin turns it back on. They have been on
                here since {format(new Date(onSince), "MMM d, h:mm a")}.
              </p>
              <p className="m-0 mt-2">The gate keeps working as usual, and CloudTime keeps a record of each person it turns away.</p>
            </>
          ) : (
            <>
              <p className="m-0">
                Roles with Live Attendance Execute get a pop up when the security gate at {site.name} turns away
                somebody with no shift today. Only people turned away from now on show up.
              </p>
              <p className="m-0 mt-2">{elsewhere}</p>
            </>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
