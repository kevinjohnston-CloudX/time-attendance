"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";
import styles from "./report-window.module.css";

/**
 * A window in Reports, built as the Export window on Live Attendance is: a
 * grey frame with the title and the footer on it, the content in white
 * cards. Escape and the scrim close it, focus comes in and goes back to
 * whatever opened it.
 */
export function ReportWindow({
  icon: Icon,
  tone,
  title,
  subtitle,
  hint,
  hintTone,
  actions,
  size = "md",
  onClose,
  closeDisabled = false,
  children,
}: {
  icon: LucideIcon;
  tone?: "error";
  title: string;
  subtitle?: string;
  /** One line on the left of the footer. */
  hint?: ReactNode;
  hintTone?: "error";
  /** The buttons, right of the footer. */
  actions: ReactNode;
  size?: "sm" | "md" | "lg";
  onClose: () => void;
  /** While something is saving, the window stays open. */
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const lockedRef = useRef(closeDisabled);
  useEffect(() => {
    closeRef.current = onClose;
    lockedRef.current = closeDisabled;
  }, [onClose, closeDisabled]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // The first field if there is one, else the window itself.
    const first = ref.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea, select");
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || lockedRef.current) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className={`${styles.scrim} ta-sheet-scrim`}
      onClick={(e) => e.target === e.currentTarget && !closeDisabled && onClose()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-window-title"
        className={`${styles.window} ta-sheet`}
        data-size={size}
      >
        <header className={styles.head}>
          <span className={styles.glyph} data-tone={tone} aria-hidden="true">
            <Icon />
          </span>
          <span className={styles.titles}>
            <h2 id="report-window-title" className={styles.title}>
              {title}
            </h2>
            {subtitle && <span className={`${styles.subtitle} truncate`}>{subtitle}</span>}
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} disabled={closeDisabled} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className={`ta-scroll ${styles.body}`}>{children}</div>
        <footer className={styles.foot}>
          <span className={styles.footHint} data-tone={hintTone} role={hintTone ? "alert" : undefined}>
            {hint}
          </span>
          {actions}
        </footer>
      </div>
    </div>,
    document.body
  );
}

/** A white card in a window; its blocks are split by full-width dividers. */
export function WindowCard({ children }: { children: ReactNode }) {
  return <section className={styles.card}>{children}</section>;
}

/** One part of a card: an optional quiet label over its content. */
export function WindowBlock({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className={styles.block}>
      {label && <span className={styles.label}>{label}</span>}
      {children}
    </div>
  );
}

export function WindowNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

/** Choices as rows: an icon in a well, a title and one line; the chosen one ringed. */
export function WindowChoices<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; icon: LucideIcon; title: string; body: string }[];
}) {
  return (
    <div role="radiogroup" className={styles.choices}>
      {options.map((o) => (
        <label key={o.value} className={styles.choice} data-on={o.value === value}>
          <input
            type="radio"
            className={styles.radio}
            name={name}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          <span className={styles.choiceIcon} aria-hidden="true">
            <o.icon />
          </span>
          <span className={styles.choiceText}>
            <span className={styles.choiceTitle}>{o.title}</span>
            <span className={styles.choiceBody}>{o.body}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
