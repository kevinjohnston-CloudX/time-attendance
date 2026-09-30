import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/app/_components/providers";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import "./globals.css";

/**
 * Inter, loaded as a variable font.
 *
 * The design system's type scale uses weight 450 ("Book") for page
 * titles and action clusters, which only exists on the variable axis —
 * a static 400/500/600/700 subset would silently round it to 500 and
 * every page title would come out heavier than the design.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  // The product is CloudTime; "time & attendance" is what it does, which is
  // the descriptor the brand lockup carries under the name.
  title: "CloudTime",
  description: "Time and attendance for CloudX Systems.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The font variable goes on <html>, not <body>. The design system's
    // tokens declare --wms-font-sans on :root, and a var() reference is
    // resolved on the element where it is declared — so --font-inter has to
    // exist on :root or that whole declaration is invalid and every element
    // inheriting from it loses the typeface.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="antialiased">
        {/* In a Suspense boundary because it reads the search params, which
            would otherwise stop every static page from being prerendered. */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
