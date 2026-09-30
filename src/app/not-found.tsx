// The new design's styles. Only this screen brings them: a not found screen's
// styles load when it shows, never on the pages around it.
import "@/app/globals.css";
import { cookies } from "next/headers";
import { LinkButton } from "@/components/ui";
import { BrandLockup } from "@/components/layout/brand-mark";
import { DesignSwitchFallback } from "@/components/layout/design-switch-fallback";
import { DESIGN_COOKIE, designFromCookie } from "@/lib/design-switch";

export default async function NotFound() {
  const design = designFromCookie((await cookies()).get(DESIGN_COOKIE)?.value);
  return (
    <DesignSwitchFallback design={design}>
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
        {/* A full load, not an in place move: on Classic this screen's styles
            must not come along to the classic dashboard. */}
        <LinkButton href="/dashboard" hierarchy="primary" reloadDocument>
          Go to Dashboard
        </LinkButton>
      </div>
    </div>
    </DesignSwitchFallback>
  );
}
