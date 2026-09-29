"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PinnedBar } from "@/components/ui";

/**
 * Pay Periods' frame, from the page handoff: the period list beside the
 * period, the list pinned and reaching the bottom of the window, and the
 * period's title and actions pinned over its column.
 *
 * <p>The list is as tall as the scrolling area it sits in, less the page's
 * own padding, measured rather than guessed so a banner above the page (a
 * super admin inside a company, say) cannot push its foot off the screen.
 * The header's height rides along as --pp-bar, so a jump to the timesheets
 * stops just under it.
 */
export function PayPeriodsShell({ rail, header, children }: { rail: ReactNode; header: ReactNode | null; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [railH, setRailH] = useState<number | null>(null);
  const [barH, setBarH] = useState(96);

  useEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    if (!root || typeof ResizeObserver !== "function") return;
    let scroller: HTMLElement | null = root.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const measure = () => {
      if (scroller) {
        const pad = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        // The page's bottom padding is 16px; the list stops where the page does.
        setRailH(Math.max(420, Math.round(scroller.clientHeight - pad - 16)));
      }
      if (bar) {
        const h = Math.round(bar.getBoundingClientRect().height);
        if (h) setBarH(h);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (scroller) ro.observe(scroller);
    if (bar) ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex flex-col items-stretch gap-[18px] lg:flex-row lg:items-start"
      style={{ "--pp-rail-h": railH ? `${railH}px` : "calc(100dvh - 7rem)", "--pp-bar": `${barH}px` } as CSSProperties}
    >
      {rail}
      <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
        {header && <PinnedBar barRef={barRef}>{header}</PinnedBar>}
        {children}
      </div>
    </div>
  );
}
