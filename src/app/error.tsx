"use client";

// The new design's styles, loaded by its own layouts rather than the shared
// root, so the classic design never gets them.
import "@/app/globals.css";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { BrandLockup } from "@/components/layout/brand-mark";

export default function Error({
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
      className="flex min-h-screen items-center justify-center px-6"
      style={{ background: "var(--surface-page)" }}
    >
      <div className="flex w-full max-w-md flex-col items-start gap-6">
        <BrandLockup />

        <div className="flex w-full flex-col gap-1.5">
          <h1 style={{ margin: 0, font: "var(--type-h1)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            Something went wrong
          </h1>
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
            Nothing you were working on has been lost. Try again, and if it keeps happening, send
            the reference below to whoever supports this system.
          </p>
        </div>

        {/* The message alone is rarely enough to find the failure in a log.
            The digest is what ties this screen to a specific server error. */}
        <div
          className="w-full rounded-lg px-3 py-2.5"
          style={{ background: "var(--surface-error)", border: "1px solid var(--stroke-error)" }}
        >
          <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>
            {error.message || "No further detail was reported."}
          </p>
          {error.digest && (
            <p
              style={{
                margin: "4px 0 0",
                font: "var(--type-caption1)",
                fontFamily: "var(--font-mono)",
                color: "var(--text-error)",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </div>

        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
