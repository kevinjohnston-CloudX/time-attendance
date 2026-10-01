"use client";

import { useState, useTransition } from "react";
import { BellOff, BellRing } from "lucide-react";
import { format } from "date-fns";
import { Button, ConfirmDialog } from "@/components/ui";
import { setGateAlerts } from "@/actions/gate-refusals.actions";

/**
 * The company wide gate alert switch, in the Live Attendance header, for
 * System Admins only (the page passes it nothing for anybody else, and the
 * action refuses them).
 *
 * <p>A plain button that says what it will do ("Turn off gate alerts"),
 * because one click changes what loss prevention sees in every building.
 * It asks first, in a sentence, and only then saves. The card on other
 * screens follows within seconds through the page's pulse.
 */
export function GateAlertsSwitch({
  onSince: stored,
  onChanged,
}: {
  /** When the alert was last turned on, or null while it is off. */
  onSince: string | null;
  onChanged: (on: boolean) => void;
}) {
  const [onSince, setOnSince] = useState(stored);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const on = onSince !== null;

  const confirm = () => {
    setError(null);
    start(async () => {
      const result = await setGateAlerts({ on: !on });
      if (!result.success) {
        setError(result.error === "FORBIDDEN" ? "Only System Admins can change gate alerts." : result.error);
        return;
      }
      setOnSince(result.data.onSince);
      setAsking(false);
      onChanged(result.data.onSince !== null);
    });
  };

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
          title={on ? "Turn off gate alerts?" : "Turn on gate alerts?"}
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
                Nobody gets the gate alert pop up, in any building, until an admin turns it back on. They have been on
                since {format(new Date(onSince), "MMM d, h:mm a")}.
              </p>
              <p className="m-0 mt-2">The gate keeps working as usual, and CloudTime keeps a record of each person it turns away.</p>
            </>
          ) : (
            <p className="m-0">
              Roles with Live Attendance Execute get a pop up when the security gate turns away somebody with no shift
              today, in every building. Only people turned away from now on show up.
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
