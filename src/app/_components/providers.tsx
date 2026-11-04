"use client";

import { useEffect } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { PhoneAppChrome } from "@/components/layout/phone-app-chrome";
import { rememberedEmailStore } from "@/lib/remembered-email";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <PhoneAppChrome />
        <RememberGoogleEmail />
        {children}
      </ThemeProvider>
    </SessionProvider>
  );
}

/** Remember me for a Google sign in: saves the address once the person is back signed in. */
function RememberGoogleEmail() {
  const email = useSession().data?.user?.email;
  useEffect(() => {
    if (email) rememberedEmailStore.finishSignIn(email);
  }, [email]);
  return null;
}
