"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PinnedBar } from "@/components/ui";

/**
 * Pay Periods' frame: the same pinned page header every screen has, then the
 * period list beside the period itself, as Team Punch History lays out its
 * people beside their punches.
 *
 * <p>The list pins under the header and reaches the bottom of the window, so
 * it is in reach however far down the period is read. The header wraps onto
 * more lines on a narrow window, so the list pins under its measured height
 * rather than a guess.
 */
export function PayPeriodsShell({ header, rail, children }: { header: ReactNode; rail: ReactNode; children: ReactNode }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(104);

  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h) setBarHeight((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-4" style={{ "--pp-bar": `${barHeight}px` } as CSSProperties}>
      <PinnedBar barRef={barRef}>{header}</PinnedBar>
      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <aside
          className="flex w-full flex-col overflow-hidden lg:sticky lg:w-80 lg:flex-none"
          style={{
            // Pinned exactly where it rests, so it never nudges when the page
            // starts to scroll: the header's height, less the 0.75rem it
            // gives back underneath, plus the 1rem gap.
            top: "calc(var(--pp-bar) + 0.25rem)",
            // The window, less the 40px top bar, that offset and the page's
            // 24px bottom padding, so it ends where the page does.
            maxHeight: "calc(100vh - 2.5rem - var(--pp-bar) - 0.25rem - 1.5rem)",
            background: "var(--surface-card)",
            borderRadius: "var(--radius-l)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          {rail}
        </aside>
        <div className="@container flex w-full min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
