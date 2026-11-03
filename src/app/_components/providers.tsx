"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { PhoneAppChrome } from "@/components/layout/phone-app-chrome";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <PhoneAppChrome />
        {children}
      </ThemeProvider>
    </SessionProvider>
  );
}
