"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Button, ConfirmDialog, Overlay } from "@/components/ui";
import {
  appLocked,
  appLockOffered,
  appLockOn,
  forgetAppLock,
  hideLaunchScreen,
  inPhoneApp,
  markUnlocked,
  onReturnAfterAway,
  setAppLock,
  stopPushNotifications,
  unlockMethod,
  verifyOwner,
  type UnlockMethod,
} from "@/lib/native-app";
import { BrandTile } from "./cloudtime-logo";

/**
 * The phone app's Face ID lock (lib/native-app.ts), mounted once by
 * PhoneAppChrome. Draws nothing in a browser.
 *
 * <p>Owns lifting the launch screen: when the lock is on, the lock is drawn
 * first and the launch screen lifts onto it, so the page never shows
 * underneath. Signed out, or on a phone that no longer has Face ID set up, it
 * steps aside rather than trap anyone. Offered once after sign in.
 *
 * <p>`onReady` runs once a signed in person is past the lock and the offer,
 * so whatever asks next does not land on top of either.
 */
export function AppLock({ onReady }: { onReady?: () => void }) {
  const { status } = useSession();
  // Read on the client's first render. The Overlay draws nothing until
  // hydration is over, so the server's unlocked first frame still matches.
  const [locked, setLocked] = useState(() => typeof window !== "undefined" && inPhoneApp() && appLocked());
  // undefined until the phone answers; null when it has nothing set up.
  const [method, setMethod] = useState<UnlockMethod | null | undefined>(undefined);
  // "due" covers the pause before the offer opens.
  const [offer, setOffer] = useState<"none" | "due" | "open">("none");
  const offerOpen = offer === "open";
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const unlock = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const ok = await verifyOwner();
    busyRef.current = false;
    setBusy(false);
    if (ok) {
      markUnlocked();
      setLocked(false);
    }
  }, []);

  // Two frames, so the lock (when on) is painted before the launch screen fades onto it.
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(hideLaunchScreen);
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !inPhoneApp()) return;
    let cancelled = false;
    let offerTimer: number | undefined;
    void (async () => {
      const m = await unlockMethod();
      if (cancelled) return;
      setMethod(m);
      if (!m) return;
      if (appLocked()) void unlock();
      else if (!appLockOn() && !appLockOffered()) {
        setOffer("due");
        offerTimer = window.setTimeout(() => setOffer("open"), 1500);
      }
    })();
    const stopWatching = onReturnAfterAway(() => {
      setLocked(true);
      void unlock();
    });
    return () => {
      cancelled = true;
      window.clearTimeout(offerTimer);
      setOffer((o) => (o === "due" ? "none" : o));
      stopWatching();
    };
  }, [status, unlock]);

  async function acceptOffer() {
    setBusy(true);
    // Proves this phone can unlock before relying on it.
    const ok = await verifyOwner();
    setBusy(false);
    setAppLock(ok);
    setOffer("none");
  }

  const showLock = locked && status !== "unauthenticated" && method !== null;
  const methodName = method ?? "Face ID";

  const ready = status === "authenticated" && method !== undefined && !showLock && offer === "none";
  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, onReady]);

  return (
    <>
      {showLock && (
        <Overlay
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-lock-title"
          className="z-[2147483000] flex flex-col items-center justify-center gap-6 px-6 text-center"
          style={{
            background: "var(--ta-canvas)",
            paddingTop: "max(24px, env(safe-area-inset-top))",
            paddingBottom: "max(24px, env(safe-area-inset-bottom))",
          }}
        >
          <BrandTile size={64} />
          <h1
            id="app-lock-title"
            style={{ margin: 0, font: "var(--weight-semibold) 20px/28px var(--font-sans)", color: "var(--text-primary)" }}
          >
            CloudTime locked
          </h1>
          <div className="flex w-full max-w-[260px] flex-col gap-2">
            <Button fullWidth onClick={() => void unlock()} disabled={busy}>
              {method ? `Unlock with ${method}` : "Unlock"}
            </Button>
            <Button
              fullWidth
              hierarchy="tertiary"
              disabled={busy}
              onClick={async () => {
                await stopPushNotifications(false);
                forgetAppLock();
                await signOut({ callbackUrl: "/login" });
              }}
            >
              Sign out
            </Button>
          </div>
        </Overlay>
      )}

      {offerOpen && method && (
        <ConfirmDialog
          tone="info"
          title={`Use ${methodName} to open CloudTime?`}
          confirmLabel={`Use ${methodName}`}
          cancelLabel="Not now"
          pending={busy}
          onConfirm={() => void acceptOffer()}
          onCancel={() => {
            setAppLock(false);
            setOffer("none");
          }}
        >
          CloudTime will ask for {methodName} when it opens, or after 15 minutes away. Only on this phone. You can turn it off in the menu.
        </ConfirmDialog>
      )}
    </>
  );
}
