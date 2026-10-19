"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import styles from "./building-windows.module.css";

/**
 * A window over Live Attendance about the building on screen: the Tablets
 * list and the Gate alerts settings. The Export window's frame, the
 * reference for every pop up: the header and the footer on a grey frame,
 * the content in white cards (styles.card) the caller draws, and a footer
 * with one hint line and a Close button, since these show and switch rather
 * than collect.
 *
 * <p>Escape, the X and the scrim close it. Drawn straight onto the page's
 * body, so the pinned header and the full screen board never sit on top.
 */
export function BuildingWindow({
  title,
  subtitle,
  icon,
  width,
  foot,
  flush = false,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon: ReactNode;
  width: number;
  /** One quiet line along the bottom, beside the Close button. */
  foot?: ReactNode;
  /** The body draws its own panes edge to edge, at a fixed height, with no padding or scroll of its own. */
  flush?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div className={`${styles.scrim} ta-sheet-scrim`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="building-window-title"
        className={`${styles.window} ta-sheet`}
        style={{ maxWidth: width, outline: "none" }}
      >
        <header className={styles.head}>
          <span className={styles.glyph} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.titles}>
            <h2 id="building-window-title" className={`${styles.title} truncate`}>
              {title}
            </h2>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        {flush ? (
          <div className={styles.flushBody}>{children}</div>
        ) : (
          <div className={`ta-scroll ${styles.body}`}>{children}</div>
        )}
        <footer className={styles.foot}>
          <span className={styles.footHint}>{foot}</span>
          <Button hierarchy="secondary" onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
