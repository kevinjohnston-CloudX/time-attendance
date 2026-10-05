"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, BellOff, Building2, Check, ChevronDown, ChevronRight, Tablet as TabletIcon } from "lucide-react";
import type { BuildingTablets } from "@/lib/presence/tablets.service";
import { countHealth } from "./tablet-health";
import styles from "./building-windows.module.css";

/**
 * The building button on Live Attendance, and the menu it opens: which
 * building to show, then this building's tablets and gate alerts, each in
 * words with how it stands, opening its window.
 *
 * <p>They live here because both are about the building on screen, and the
 * page's top bar has room for one building control, not three. The button
 * carries a red dot while one of the building's tablets needs attention, so a
 * problem shows without opening anything.
 */
const MENU_WIDTH = 300;

export function BuildingMenu({
  sites,
  siteId,
  siteName,
  onChangeSite,
  buttonClassName,
  tablets,
  gateOn,
  onOpenTablets,
  onOpenGate,
}: {
  sites: { id: string; name: string }[];
  siteId: string;
  siteName: string;
  onChangeSite: (id: string) => void;
  /** The page's own building button style. */
  buttonClassName: string;
  /** This building's tablets, or undefined for a viewer who does not get the list. */
  tablets?: BuildingTablets | null;
  /** Whether gate alerts are on here, or undefined for anybody but a System Admin. */
  gateOn?: boolean;
  onOpenTablets: () => void;
  onOpenGate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Drawn on the page's body and placed under the button, so a narrow window
  // or a column that clips sideways can never cut it off.
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const put = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
      setPlace({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
    };
    put();
    window.addEventListener("resize", put);
    // The page scrolling under an open menu would leave it behind; it closes instead.
    // Only the page: scrolling the menu's own list of buildings keeps it open.
    const close = (e: Event) => {
      if (panel.current && e.target instanceof Node && panel.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", put);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const seesTablets = tablets !== undefined;
  const counts = tablets ? countHealth(tablets.tablets) : null;
  const n = tablets?.tablets.length ?? 0;
  const tabletTone = !counts ? "quiet" : counts.ATTENTION > 0 ? "bad" : counts.WORKING > 0 ? "ok" : "quiet";
  const tabletStatus = !tablets
    ? "Loading"
    : n === 0
      ? "None found"
      : counts!.ATTENTION > 0
        ? `${counts!.ATTENTION} ${counts!.ATTENTION === 1 ? "needs" : "need"} attention`
        : counts!.WORKING === n
          ? `All ${n} working`
          : counts!.WORKING > 0
            ? `${counts!.WORKING} of ${n} working`
            : `${n} need the update`;

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        className={`ta-chip ${buttonClassName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={tabletTone === "bad" ? `${siteName}: ${tabletStatus}` : siteName}
      >
        <Building2 className="h-4 w-4 flex-none" style={{ color: "var(--icon-secondary)" }} aria-hidden="true" />
        <span className="truncate">{siteName}</span>
        {tabletTone === "bad" && <span className={styles.alertDot} aria-label={tabletStatus} />}
        <ChevronDown className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={panel}
            className={styles.menu}
            role="menu"
            aria-label="Building"
            style={{ top: place.top, left: place.left, width: Math.min(MENU_WIDTH, window.innerWidth - 16) }}
          >
            {sites.length > 1 && (
              <>
                <div className={`wms-overline ${styles.menuLabel}`}>Building</div>
                <div className={`ta-scroll ${styles.menuSites}`}>
                  {sites.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={s.id === siteId}
                      className={styles.menuItem}
                      onClick={pick(() => s.id !== siteId && onChangeSite(s.id))}
                    >
                      <span className={styles.menuCheck} aria-hidden="true">
                        {s.id === siteId && <Check />}
                      </span>
                      <span className={styles.menuText}>{s.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {(seesTablets || gateOn !== undefined) && (
              <>
                {sites.length > 1 && <div className={styles.menuDivider} role="separator" />}
                <div className={`wms-overline ${styles.menuLabel}`} title={siteName}>
                  {siteName}
                </div>
                {seesTablets && (
                  <button type="button" role="menuitem" className={styles.menuItem} onClick={pick(onOpenTablets)}>
                    <span className={styles.menuIcon} aria-hidden="true">
                      <TabletIcon />
                    </span>
                    <span className={styles.menuText}>Tablets</span>
                    <span className={styles.menuStatus}>
                      <span className={styles.chipDot} data-tone={tabletTone} aria-hidden="true" />
                      {tabletStatus}
                    </span>
                    <ChevronRight className={styles.menuChev} aria-hidden="true" />
                  </button>
                )}
                {gateOn !== undefined && (
                  <button type="button" role="menuitem" className={styles.menuItem} onClick={pick(onOpenGate)}>
                    <span className={styles.menuIcon} aria-hidden="true">
                      {gateOn ? <Bell /> : <BellOff />}
                    </span>
                    <span className={styles.menuText}>Gate alerts</span>
                    <span className={styles.menuStatus}>
                      <span className={styles.chipDot} data-tone={gateOn ? "ok" : "quiet"} aria-hidden="true" />
                      {gateOn ? "On" : "Off"}
                    </span>
                    <ChevronRight className={styles.menuChev} aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
