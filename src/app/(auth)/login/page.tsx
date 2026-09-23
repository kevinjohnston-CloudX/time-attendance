"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Banner, Button, Checkbox, Input } from "@/components/ui";
import { BrandLockup } from "@/components/layout/brand-mark";
import { rememberedEmailStore, useRememberedEmail } from "@/lib/remembered-email";

/**
 * Sign-in, as the portal design draws it: a 360px column on the card surface
 * at the left, the brand panel filling the right half.
 *
 * <p>The design leads with email and password, so that form comes first and
 * Google sits under an "or" — the other way round taught everyone to reach for
 * the button most of this workforce cannot use, because only the office
 * accounts have Google identities.
 *
 * <p>The right-hand panel is hidden below the `lg` breakpoint. On a phone a
 * decorative panel above the fold means scrolling to reach the password box.
 */
export default function LoginPage() {
  const remembered = useRememberedEmail();
  // Null until the person touches them, so both fall back to what this
  // browser remembered. Stored values arrive after the first render, and
  // deriving from them avoids copying them into state from an effect.
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const [rememberChoice, setRememberChoice] = useState<boolean | null>(null);
  const email = typedEmail ?? remembered;
  const remember = rememberChoice ?? remembered !== "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // With the address already filled in, the password is the next thing to
  // type, so the cursor starts there. Once only: never pull focus back later.
  const focused = useRef(false);
  useEffect(() => {
    if (remembered && !focused.current) {
      focused.current = true;
      document.getElementById("password")?.focus();
    }
  }, [remembered]);

  function handleRememberChange(next: boolean) {
    setRememberChoice(next);
    // Unticking forgets straight away, not at the next sign-in, so someone
    // walking away from a shared computer leaves nothing behind.
    if (!next) rememberedEmailStore.forget();
  }

  async function handleGoogleSignIn() {
    setError("");
    setLoading(true);
    await signIn("google", { callbackUrl: "/dashboard" });
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      username: email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setLoading(false);
      setError("Invalid email or password.");
      return;
    }

    if (remember) rememberedEmailStore.save(email.trim());
    else rememberedEmailStore.forget();

    // Deliberately left loading: the page is about to be replaced, and
    // re-enabling the button first invites a second submit into the gap.

    // A real navigation rather than a client-side push. The browser only
    // offers to save a password when it sees a credential submission followed
    // by one, so a soft route change here is why nothing was ever saved for
    // this site. It also guarantees the first render after sign-in is made
    // with the new session cookie rather than the one the app started with.
    window.location.assign("/dashboard");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div
        className="flex items-center justify-center px-6 py-12"
        style={{ background: "var(--surface-card)" }}
      >
        <div className="flex w-full max-w-[360px] flex-col gap-6">
          {/* 16px, not the 6px this used to be: the lockup now ends in a
              tracked uppercase descriptor, and the handoff asks for clear
              space equal to the dial's radius — about 14px at this size —
              before the next line of type starts competing with it. */}
          <div className="flex flex-col gap-4">
            <BrandLockup />
            {/* The lockup is a wordmark, not a heading. Without this the page
                has no h1 at all, which is the one thing a screen reader uses
                to say which screen it landed on. */}
            <h1 className="sr-only">Sign in</h1>
            <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
              Sign in with your company account.
            </p>
          </div>

          <form onSubmit={handleCredentials} className="flex flex-col gap-2.5">
            <Input
              id="email"
              // name and autoComplete together are what a password manager
              // matches on. "username" rather than "email": email is an
              // address-book token, so browsers fill it from saved addresses
              // instead of pairing it with the password field as a credential.
              name="username"
              type="email"
              label="Work Email"
              autoComplete="username"
              // Clearing a remembered address leaves it one click away. A
              // datalist rather than a menu of our own, because the browser
              // merges it into its own suggestions: two dropdowns would open
              // on top of each other for anyone with a saved password.
              list={remembered ? "remembered-email" : undefined}
              value={email}
              onChange={(e) => setTypedEmail(e.target.value)}
              required
              placeholder="you@company.com"
            />
            {remembered && (
              <datalist id="remembered-email">
                <option value={remembered} />
              </datalist>
            )}

            <Input
              id="password"
              name="password"
              type="password"
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />

            <div className="flex items-center justify-between gap-3">
              <Checkbox
                id="remember"
                checked={remember}
                onChange={handleRememberChange}
                label={<span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Remember me</span>}
              />
              <Link
                href="/forgot-password"
                style={{ font: "var(--type-body2)", color: "var(--link-accent)" }}
              >
                Forgot password?
              </Link>
            </div>

            {error && <Banner tone="error" body={error} />}

            <Button type="submit" disabled={loading} fullWidth>
              {loading ? "Signing in…" : "Sign In"}
            </Button>

            {/* Most people who work here never see this page — they tap a badge
                at a wall-mounted tablet. Saying so stops them hunting for a
                password they were never issued. */}
            <p
              className="text-center"
              style={{ margin: 0, font: "var(--type-caption1)", color: "var(--text-secondary)" }}
            >
              Kiosk users: tap your badge at the timeclock instead.
            </p>
          </form>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: "var(--stroke-divider)" }} />
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>or</span>
            <div className="h-px flex-1" style={{ background: "var(--stroke-divider)" }} />
          </div>

          <Button
            hierarchy="secondary"
            fullWidth
            disabled={loading}
            onClick={handleGoogleSignIn}
            leadingIcon={<GoogleMark />}
          >
            Sign in with Google
          </Button>
        </div>
      </div>

      <aside
        className="hidden flex-col justify-end gap-5 p-12 lg:flex"
        style={{ background: "var(--wms-color-primary-950)", color: "var(--wms-color-base-white)" }}
      >
        <p
          style={{
            margin: 0,
            maxWidth: 420,
            font: "var(--weight-book) 26px/34px var(--font-sans)",
            letterSpacing: "-0.01em",
          }}
        >
          One place for punches, timesheets, leave and payroll close.
        </p>
        <div
          className="flex flex-wrap gap-7"
          style={{ font: "var(--type-body2)", color: "var(--wms-color-primary-200)" }}
        >
          <span>Punch to paycheck in one trail</span>
          <span>Exceptions surfaced before close</span>
        </div>
      </aside>
    </div>
  );
}

/** Google's own brand colours — not ours to theme, so no tokens here. */
function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
