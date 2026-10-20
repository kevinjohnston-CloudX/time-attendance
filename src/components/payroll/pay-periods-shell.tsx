"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { PinnedBar } from "@/components/ui";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/components/layout/navigation-progress";
import { isPhone, usePhoneLayout } from "@/lib/phone";
import { usePhoneBack } from "@/components/layout/phone-back";
import styles from "./pay-periods.module.css";

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
/** Where the list was scrolled to when a period was opened from it. */
const LIST_SCROLL_KEY = "cloudtime.pay-periods.list-scroll";

export function PayPeriodsShell({
  rail,
  header,
  selectedId,
  children,
}: {
  rail: ReactNode;
  header: ReactNode | null;
  /** The period the page opened, so a phone knows when the tapped one has arrived. */
  selectedId?: string;
  children: ReactNode;
}) {
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


  /**
   * On a phone, whether the open period shows instead of the list. A phone
   * shows the two one after the other (pay-periods.module.css), and the page
   * always opens a period (today's when none is named), so a phone starts on
   * the list. Kept in the address (open=1) rather than in state: the route
   * has a loading screen, which rebuilds this frame on every move, and the
   * address also gives the phone's own Back gesture the right answer.
   */
  const router = useRouter();
  const searchParams = useSearchParams();
  const phoneView = searchParams.get("open") && selectedId ? "period" : "list";
  const scroller = () => rootRef.current?.closest("main") ?? null;

  // Back on the list where it was left, and at the top of a period.
  useLayoutEffect(() => {
    if (!isPhone()) return;
    const main = scroller();
    if (!main) return;
    if (phoneView === "period") {
      main.scrollTo({ top: 0 });
      return;
    }
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(LIST_SCROLL_KEY);
      sessionStorage.removeItem(LIST_SCROLL_KEY);
    } catch {
      // Storage can be blocked; the list then opens at the top.
    }
    if (saved) main.scrollTo({ top: Number(saved) || 0 });
  }, [phoneView]);

  /** A period tapped in the list (a link the rail draws): on a phone, open it. */
  function onRailClick(e: MouseEvent<HTMLDivElement>) {
    if (!isPhone()) return;
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href*="id="]');
    if (!link) return;
    e.preventDefault();
    try {
      sessionStorage.setItem(LIST_SCROLL_KEY, String(scroller()?.scrollTop ?? 0));
    } catch {
      // Without storage the list just opens at the top on the way back.
    }
    const url = new URL(link.href);
    url.searchParams.set("open", "1");
    router.push(`${url.pathname}${url.search}`);
  }

  // The way back to the list is the top bar's, as in any phone app.
  const phone = usePhoneLayout();
  usePhoneBack(phone && phoneView === "period" ? "Pay Periods" : null, () => backToList());

  function backToList() {
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    // Not Next's own scroll to the top: the list puts itself back where it
    // was left (the effect above).
    router.push(`${url.pathname}${url.search}`, { scroll: false });
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.shell} flex flex-col items-stretch gap-[18px] lg:flex-row lg:items-start`}
      data-phone-view={phoneView}
      onClickCapture={onRailClick}
      style={{ "--pp-rail-h": railH ? `${railH}px` : "calc(100dvh - 7rem)", "--pp-bar": `${barH}px` } as CSSProperties}
    >
      {rail}
      <div className={`${styles.detail} flex min-w-0 flex-1 flex-col gap-[18px]`}>
        {header && <PinnedBar barRef={barRef}>{header}</PinnedBar>}
        {children}
      </div>
    </div>
  );
}
