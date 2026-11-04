"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { matchSystemBars, startPushNotifications } from "@/lib/native-app";
import { AppLock } from "./app-lock";

/**
 * Inside the phone app only (mobile-app/): keeps the status bar icons readable
 * on the current theme, draws the Face ID lock, which also lifts the launch
 * screen, and once someone is signed in and past the lock turns on
 * notifications for them on this phone (the phone asks permission the first
 * time). In a browser every call does nothing and nothing is drawn.
 */
export function PhoneAppChrome() {
  const { resolvedTheme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (resolvedTheme) matchSystemBars(resolvedTheme === "dark");
  }, [resolvedTheme]);

  // Waits for the lock: the phone's permission prompt drawn over the lock
  // screen, or over the Face ID offer, is two questions at once.
  const startPush = useCallback(() => void startPushNotifications((href) => router.push(href)), [router]);

  return <AppLock onReady={startPush} />;
}
