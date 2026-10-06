"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import styles from "./building-windows.module.css";

/**
 * A window over Live Attendance about the building on screen: the Tablets
 * list and the Gate alerts settings. The setup dialogs' shape (the area's
 * glyph in a well, a title and one line under it), with no form and no
 * footer buttons, since these show and switch rather than collect.
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
  actions,
  flush = false,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon: ReactNode;
  width: number;
  /** One quiet line along the bottom. */
  foot?: ReactNode;
  /** Controls for the whole window, beside the title (the Tablets filter). */
  actions?: ReactNode;
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
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="building-window-title"
        className={`ta-modal ${styles.window}`}
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
          {actions && <div className={styles.actions}>{actions}</div>}
          <span className={styles.close}>
            <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </span>
        </header>
        {flush ? (
          <div className={styles.flushBody}>{children}</div>
        ) : (
          <div className={`ta-scroll ${styles.body}`}>{children}</div>
        )}
        {foot && <footer className={styles.foot}>{foot}</footer>}
      </div>
    </div>,
    document.body,
  );
}
