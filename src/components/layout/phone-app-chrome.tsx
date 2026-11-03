"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { hideLaunchScreen, matchSystemBars } from "@/lib/native-app";

/**
 * Inside the phone app only (mobile-app/): lifts the launch screen once the
 * first page has drawn, and keeps the status bar icons readable on the
 * current theme. In a browser both calls do nothing. Draws nothing.
 */
export function PhoneAppChrome() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    hideLaunchScreen();
  }, []);

  useEffect(() => {
    if (resolvedTheme) matchSystemBars(resolvedTheme === "dark");
  }, [resolvedTheme]);

  return null;
}
