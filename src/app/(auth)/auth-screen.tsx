import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui";
import { BrandLockup } from "@/components/layout/brand-mark";

/**
 * The password screens, as the design draws them: lockup, title, one line of
 * explanation, the form, a hint, and a way back to sign-in — centred in a
 * 380px column on the page surface.
 *
 * <p>All three screens behind it (reset, first-time setup, forced change) are
 * the same shape, and they had drifted: three different heading sizes, two
 * different ways back to /login, and a "reset" screen that was a split layout
 * with an empty brand panel beside a paragraph.
 *
 * <p>No "use client" on purpose. Nothing here is interactive, so it compiles
 * into whichever side imports it — the server component at /forgot-password
 * and the client components that carry the two password forms.
 */
export function AuthScreen({
  title,
  sub,
  note,
  children,
}: {
  title: string;
  sub: string;
  /** The caption under the action — what happens next, or what the limits are. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-[380px] flex-col gap-[22px]">
        <BrandLockup />

        <div className="flex flex-col gap-1">
          <h1 style={{ margin: 0, font: "var(--type-h2)", letterSpacing: "-0.02em" }}>{title}</h1>
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            {sub}
          </p>
        </div>

        {children}

        <div className="flex flex-col items-start gap-3">
          {note && (
            <p
              style={{
                margin: 0,
                font: "var(--type-caption1)",
                color: "var(--text-secondary)",
                textWrap: "pretty",
              }}
            >
              {note}
            </p>
          )}
          <LinkButton href="/login" hierarchy="link" size="sm">
            Back to sign in
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
