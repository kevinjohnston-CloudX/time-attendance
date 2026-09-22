"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui";
import { AlertTriangle } from "lucide-react";

/**
 * Team Leave when one of its queries fails.
 *
 * <p>Scoped to this route rather than falling through to the app-wide error
 * screen. A failure counting leave should not look like the whole product has
 * fallen over: the sidebar stays, the person can go back to the team portal,
 * and retrying re-runs only this page.
 *
 * <p>It says plainly that nothing was approved or changed, because the one
 * thing a supervisor will wonder is whether the button they just pressed took
 * effect before the screen broke.
 */
export default function TeamLeaveError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      className="flex flex-col items-start gap-4 px-6 py-12"
      style={{
        border: "1px solid var(--stroke-secondary)",
        borderRadius: 12,
        background: "var(--surface-card)",
      }}
    >
      <span style={{ color: "var(--icon-warning)" }}>
        <AlertTriangle className="h-8 w-8" aria-hidden="true" />
      </span>

      <div className="flex flex-col gap-1.5">
        <h1 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
          Team leave could not be loaded
        </h1>
        <p
          className="max-w-prose"
          style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}
        >
          Nothing has been approved, rejected or changed. Try again, and if it keeps happening,
          send the reference below to whoever supports this system.
        </p>
      </div>

      {error.digest && (
        <p
          className="tabular"
          style={{
            margin: 0,
            font: "var(--type-body2)",
            color: "var(--text-tertiary)",
          }}
        >
          Reference {error.digest}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <LinkButton href="/supervisor" hierarchy="secondary">
          Back to Team Portal
        </LinkButton>
      </div>
    </div>
  );
}
