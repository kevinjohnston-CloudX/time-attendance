import { Geist, Geist_Mono } from "next/font/google";
import "@/classic/classic.css";

/**
 * The classic design's frame: prod's fonts and styles, and nothing of the new
 * design's. Its pages live under /classic but are never opened there: the
 * proxy serves them at the ordinary address to anyone whose design is
 * Classic (see lib/design.ts), so the address bar never changes with the
 * design. Switching design reloads the page, so one design's styles never
 * linger on the other's pages.
 */
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export default function ClassicLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</div>;
}
