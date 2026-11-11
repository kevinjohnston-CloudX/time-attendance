"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { Overlay } from "./overlay";
import styles from "./window.module.css";

/**
 * Every pop up in CloudTime: the Export window's frame, shared.
 *
 * <p>A grey frame with the header and the footer on it, and the content in
 * white raised cards the caller draws (WindowCard, WindowBlock). The header is
 * a raised glyph tile, the title and one line, then close. The footer holds
 * one quiet line on the left and the buttons on the right. On a phone the
 * same window opens as a sheet from the bottom edge.
 *
 * <p>One fixed shape: pass a size, and a body that keeps its height between
 * states, so a window never jumps while it is open. Escape, the X and the
 * scrim close it, except while it is busy saving. Focus moves in on open,
 * stays inside while it is open, and goes back to the button that opened it.
 * When a window opens on top of another, only the top one answers Escape.
 */

const SIZES = { sm: 480, md: 640, lg: 880, xl: 1000 } as const;
export type WindowSize = keyof typeof SIZES;
export type WindowTone = "accent" | "danger" | "warning" | "success";

/** The open windows, newest last, so Escape only reaches the top one. */
const stack: string[] = [];

export function Window({
  title,
  subtitle,
  icon,
  tone = "accent",
  size = "md",
  width,
  foot,
  footTone,
  actions,
  busy = false,
  flush = false,
  closeOnScrim = true,
  dismissible = true,
  alert = false,
  side = false,
  onSubmit,
  initialFocus,
  bodyClassName,
  className,
  onClose,
  children,
}: {
  title: ReactNode;
  /** One line under the title. */
  subtitle?: ReactNode;
  icon: ReactNode;
  tone?: WindowTone;
  size?: WindowSize;
  /** An exact width, for a window whose content sets it (overrides size). */
  width?: number;
  /** One quiet line along the bottom, beside the buttons. */
  foot?: ReactNode;
  footTone?: "warning" | "error";
  /** The buttons, right aligned; Close when omitted. */
  actions?: ReactNode;
  /** Saving: Escape, the X and the scrim do nothing, so nothing is cut off halfway. */
  busy?: boolean;
  /** The body draws its own panes edge to edge, with no scroll of its own. */
  flush?: boolean;
  closeOnScrim?: boolean;
  /** False for a window that must be closed on purpose, by its own button
   *  (a key shown once): no X, and Escape and the scrim do nothing. */
  dismissible?: boolean;
  /** A confirmation: read out as an alert, and always above whatever opened it. */
  alert?: boolean;
  /** A panel down the right edge, full height, for looking through a list
   *  one entry at a time while the list stays in view. A sheet on a phone. */
  side?: boolean;
  /** A form window: the body and the footer are one form, so Enter in a
   *  field and a submit button in the actions both send it. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** The field to start in, or a box holding it, when typing is the reason
   *  the window opened. */
  initialFocus?: RefObject<HTMLElement | null>;
  bodyClassName?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const ref = useRef<HTMLDivElement>(null);
  const [depth, setDepth] = useState(1);

  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy || !dismissible;
  }, [onClose, busy, dismissible]);

  useEffect(() => {
    stack.push(id);
    // Counted once, on open: a window opened over another sits above it.
    setDepth(alert || stack.length > 1 ? 2 : 1);
    const opener = document.activeElement as HTMLElement | null;
    const start = initialFocus?.current;
    const field = start && !start.matches("input, textarea, select") ? start.querySelector<HTMLElement>("input, textarea, select") : start;
    (field ?? ref.current)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!busyRef.current) closeRef.current();
        return;
      }
      // Keep Tab inside the window.
      if (e.key === "Tab" && ref.current) {
        const all = [...ref.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )].filter((el) => el.offsetParent !== null);
        if (all.length === 0) return;
        const first = all[0];
        const last = all[all.length - 1];
        const at = document.activeElement;
        if (e.shiftKey && (at === first || at === ref.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const at = stack.lastIndexOf(id);
      if (at >= 0) stack.splice(at, 1);
      opener?.focus?.({ preventScroll: true });
    };
    // Depth is set once, on open; alert never changes while a window is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const close = () => {
    if (!busy && dismissible) onClose();
  };

  const body = (
    <div className={`${flush ? styles.flush : `ta-scroll ${styles.body}`}${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
  );
  const footer = (
    <footer className={styles.foot}>
      <span className={styles.footHint} data-tone={footTone} aria-live="polite">
        {foot}
      </span>
      <span className={`${styles.actions} ta-sheet-actions`}>
        {actions ?? (
          <Button hierarchy="secondary" onClick={close} disabled={busy}>
            Close
          </Button>
        )}
      </span>
    </footer>
  );

  return (
    <Overlay
      className={`${styles.scrim} ta-sheet-scrim`}
      data-depth={depth}
      data-side={side || undefined}
      onClick={(e) => closeOnScrim && e.target === e.currentTarget && close()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        data-alert={alert || undefined}
        data-side={side || undefined}
        className={`${styles.window} ta-sheet${className ? ` ${className}` : ""}`}
        style={{ maxWidth: width ?? SIZES[size] }}
      >
        <header className={styles.head}>
          <span className={styles.glyph} data-tone={tone} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </span>
          {dismissible && (
            <Button hierarchy="tertiary" size="sm" iconOnly onClick={close} disabled={busy} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          )}
        </header>

        {onSubmit ? (
          <form className={styles.form} onSubmit={onSubmit}>
            {body}
            {footer}
          </form>
        ) : (
          <>
            {body}
            {footer}
          </>
        )}
      </div>
    </Overlay>
  );
}

/** A white raised card on the window's grey. `padded` for a card of loose content. */
export function WindowCard({
  padded = false,
  className,
  children,
  ...rest
}: { padded?: boolean; className?: string; children: ReactNode; ref?: React.Ref<HTMLElement> } & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <section {...rest} className={`${styles.card}${className ? ` ${className}` : ""}`} data-padded={padded || undefined}>
      {children}
    </section>
  );
}

/** One block of a card, split from the next by a full width rule, with an optional label and one quiet line. */
export function WindowBlock({ label, note, className, children }: { label?: ReactNode; note?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={`${styles.block}${className ? ` ${className}` : ""}`}>
      {label && <h3 className={styles.label}>{label}</h3>}
      {note && <p className={styles.note}>{note}</p>}
      {children}
    </div>
  );
}

/** A quiet label over a group of cards or rows. */
export function WindowGroupLabel({ children }: { children: ReactNode }) {
  return <h3 className={styles.groupLabel}>{children}</h3>;
}

/** Read only facts: a label and its value on each line. */
export function WindowFacts({ rows }: { rows: { label: string; value: ReactNode; title?: string }[] }) {
  return (
    <dl className={styles.facts}>
      {rows.map((r) => (
        <div key={r.label} className={styles.fact}>
          <dt className={styles.factLabel}>{r.label}</dt>
          <dd className={styles.factValue} title={r.title}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
