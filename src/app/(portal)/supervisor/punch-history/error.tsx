"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, LinkButton } from "@/components/ui";

/**
 * Team Punch History when one of its reads fails.
 *
 * <p>Scoped to this route, so the sidebar stays and retrying re-runs only
 * this page. The screen only reads, so the message says the punches
 * themselves are untouched: in a dispute, the first worry is whether a
 * failure here could have changed someone's record.
 */
export default function PunchHistoryError({
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
        borderRadius: "var(--radius-l)",
        background: "var(--surface-card)",
      }}
    >
      <span style={{ color: "var(--icon-warning)" }}>
        <AlertTriangle className="h-8 w-8" aria-hidden="true" />
      </span>

      <div className="flex flex-col gap-1.5">
        <h1 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
          Team Punch History could not be loaded
        </h1>
        <p className="max-w-prose" style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
          This screen only reads punches, so no record has been changed. Try again, and if it keeps
          happening, send the reference below to whoever supports this system.
        </p>
      </div>

      {error.digest && (
        <p className="tabular" style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
          Reference {error.digest}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <LinkButton href="/supervisor" hierarchy="secondary">
          Back to Team Overview
        </LinkButton>
      </div>
    </div>
  );
}
