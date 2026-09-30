// The new design's styles, loaded by its own layouts rather than the shared
// root, so the classic design never gets them.
import "@/app/globals.css";
import { LinkButton } from "@/components/ui";
import { BrandLockup } from "@/components/layout/brand-mark";
import { DesignSwitchFallback } from "@/components/layout/design-switch-fallback";

export default function NotFound() {
  return (
    <DesignSwitchFallback>
    <div
      className="flex min-h-screen items-center justify-center px-6"
      style={{ background: "var(--surface-page)" }}
    >
      <div className="flex w-full max-w-sm flex-col items-start gap-6">
        <BrandLockup />
        <div className="flex flex-col gap-1.5">
          <p
            style={{
              margin: 0,
              font: "var(--type-overline)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-tertiary)",
            }}
          >
            404
          </p>
          <h1 style={{ margin: 0, font: "var(--type-h1)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            Page not found
          </h1>
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
            That address does not exist. If you followed a link from inside the product, please tell
            the HR team, because a page is pointing somewhere that is not there.
          </p>
        </div>
        <LinkButton href="/dashboard" hierarchy="primary">
          Go to Dashboard
        </LinkButton>
      </div>
    </div>
    </DesignSwitchFallback>
  );
}
