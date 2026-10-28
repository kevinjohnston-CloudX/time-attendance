import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/app/_components/providers";
import { NavigationProgress } from "@/components/layout/navigation-progress";

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
  // the descriptor the brand lockup carries under the name. The dev server
  // says [LOCAL] so its tab is never mistaken for the live site. Two locks:
  // only `next dev` runs as "development", and Vercel sets VERCEL on every
  // build and server, so the live site always reads plain "CloudTime".
  title:
    process.env.NODE_ENV === "development" && !process.env.VERCEL
      ? "[LOCAL] CloudTime"
      : "CloudTime",
  description: "Time and attendance for CloudX Systems.",
};

/**
 * The page reaches under an iPhone's notch and home bar ("cover"), so the
 * phone frame can paint those strips itself and pad its bars by the safe area
 * insets, as a native app does. Zoom stays allowed: people who need larger
 * text pinch to get it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
