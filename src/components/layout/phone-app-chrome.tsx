"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { matchSystemBars, startPushNotifications } from "@/lib/native-app";
import { AppLock } from "./app-lock";

/**
 * Inside the phone app only (mobile-app/): keeps the status bar icons readable
 * on the current theme, once someone is signed in turns on notifications for
 * them on this phone (the phone asks permission the first time), and draws
 * the Face ID lock, which also lifts the launch screen. In a browser every
 * call does nothing and nothing is drawn.
 */
export function PhoneAppChrome() {
  const { resolvedTheme } = useTheme();
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (resolvedTheme) matchSystemBars(resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    if (status === "authenticated") void startPushNotifications((href) => router.push(href));
  }, [status, router]);

  return <AppLock />;
}
