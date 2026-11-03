"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { hideLaunchScreen, matchSystemBars, startPushNotifications } from "@/lib/native-app";

/**
 * Inside the phone app only (mobile-app/): lifts the launch screen once the
 * first page has drawn, keeps the status bar icons readable on the current
 * theme, and once someone is signed in, turns on notifications for them on
 * this phone (the phone asks permission the first time). In a browser every
 * call does nothing. Draws nothing.
 */
export function PhoneAppChrome() {
  const { resolvedTheme } = useTheme();
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    hideLaunchScreen();
  }, []);

  useEffect(() => {
    if (resolvedTheme) matchSystemBars(resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    if (status === "authenticated") void startPushNotifications((href) => router.push(href));
  }, [status, router]);

  return null;
}
