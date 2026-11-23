"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { floatingPortal, useOutsidePress } from "./floating-layer";
import styles from "./menu.module.css";

/**
 * The shared menu: the account menu's look, for every pop over that drops
 * from a button (row actions, the Building menu, View options). These draw
 * what is inside it, the same everywhere. A menu that drops from a button
 * goes in MenuPopover, which places it under the button at the end of the
 * page; MenuPanel is the bare card for a caller that places it itself.
 */

export const menuStyles = styles;

/** The white card. Pass role="menu" for a list of actions. */
export function MenuPanel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`${styles.panel}${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

/** What the menu is about, as a title and one quiet line, with a rule under it. */
export function MenuHead({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <div className={styles.head}>
        <span className={styles.headTitle}>{title}</span>
        {sub && <span className={styles.headSub}>{sub}</span>}
      </div>
      <MenuDivider />
    </>
  );
}

/** A quiet sentence case label over a group of rows. */
export function MenuLabel({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className={styles.label} title={title}>
      {children}
    </div>
  );
}

export function MenuDivider() {
  return <div className={styles.divider} role="separator" />;
}

/** One action: its icon, then what it does. Danger for what removes or revokes. */
export function MenuItem({
  icon,
  tone,
  children,
  className,
  ...rest
}: { icon?: ReactNode; tone?: "danger"; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="menuitem"
      {...rest}
      data-tone={tone}
      className={`ta-hoverable ${styles.item}${className ? ` ${className}` : ""}`}
    >
      {icon && (
        <span className={styles.itemIcon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.itemText}>{children}</span>
    </button>
  );
}

/**
 * Closes an open menu on Escape or a press anywhere outside `ref` (and
 * `panel`, for a menu drawn at the end of the page), and puts focus back on
 * the button that opened it (the one marked expanded) after Escape. Escape is
 * taken before a window under the menu hears it, so it closes the menu only.
 */
export function useMenuDismiss(
  open: boolean,
  close: () => void,
  ref: RefObject<HTMLElement | null>,
  panel?: RefObject<HTMLElement | null>,
) {
  // A press on a dropdown's list or a window drawn over the menu is not outside it.
  useOutsidePress({ open, inside: panel ? [ref, panel] : [ref], onOutside: close });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      ref.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, ref]);
}

const GAP = 4;
const EDGE = 8;
/** The least a menu is given when neither side of its button has room. */
const MIN_HEIGHT = 120;
const CHOICES = '[role="menuitem"]:not(:disabled)';

/** The button a menu drops from: the one marked expanded inside `anchor`. */
function openerIn(anchor: HTMLElement | null): HTMLElement | null {
  return anchor?.querySelector<HTMLElement>('[aria-expanded="true"]') ?? anchor;
}

/**
 * Under the button with the right edges lined up, or over it when there is
 * no room below and more above; never past an edge of the window. When
 * neither side holds all of it, the roomier side takes it and the menu
 * scrolls.
 */
function placeMenu(panel: HTMLElement, opener: HTMLElement) {
  const r = opener.getBoundingClientRect();
  panel.style.maxHeight = "";
  const { offsetWidth: width, offsetHeight: height } = panel;
  const below = window.innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const up = height > below && above > below;
  const room = Math.max(up ? above : below, MIN_HEIGHT);
  if (height > room) panel.style.maxHeight = `${room}px`;
  const drawn = Math.min(height, room);
  panel.style.top = `${up ? r.top - GAP - drawn : r.bottom + GAP}px`;
  panel.style.left = `${Math.max(EDGE, Math.min(r.right - width, window.innerWidth - EDGE - width))}px`;
}

/**
 * The last key pressed, and on what. Enter or Space on a menu's button opens
 * it before the browser marks the button as reached from the keys, so
 * :focus-visible cannot tell a menu opened from the keys from one opened by
 * a press.
 */
let lastKey: { on: EventTarget | null; at: number } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      lastKey = { on: e.target, at: Date.now() };
    },
    true,
  );
}

/** Whether a key on the button, not a press, opened the menu just now. */
function fromKeys(opener: HTMLElement) {
  return lastKey !== null && lastKey.on === opener && Date.now() - lastKey.at < 1000;
}

/**
 * A menu dropped from a button, drawn at the end of the page so no scroll box
 * clips it: inside its table's sideways scroll, the API key menu lost
 * Regenerate and Revoke under the table's edge. `anchor` holds the button,
 * marked expanded while the menu is open. Render it only while open.
 *
 * <p>It sits under the button, or over it when there is no room below. A
 * press outside the button and the menu closes it, and so does a scroll of
 * anything under it, which would leave it away from its button. From the
 * keys: the first choice takes the focus, the arrows, Home and End move
 * between choices, Escape closes it with the focus back on the button, and
 * Tab goes on from the button. Picking a choice puts the focus back on the
 * button too, so a window the choice opens returns there when it closes.
 */
export function MenuPopover({
  anchor,
  onClose,
  className,
  onKeyDown,
  onClickCapture,
  children,
  ...rest
}: { anchor: RefObject<HTMLElement | null>; onClose: () => void } & HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(true, onClose, anchor, ref);

  // Placed before it is first painted, then the focus moves in: onto the
  // first choice when the keys opened it, onto the menu itself after a press,
  // so the arrows and Tab reach it either way with no ring under the pointer.
  useLayoutEffect(() => {
    const panel = ref.current;
    const opener = openerIn(anchor.current);
    if (!panel || !opener) return;
    placeMenu(panel, opener);
    const first = fromKeys(opener) ? panel.querySelector<HTMLElement>(CHOICES) : null;
    (first ?? panel).focus({ preventScroll: true });
  }, [anchor]);

  // A new window size moves it with its button. A scroll anywhere but inside
  // it closes it, as it does the dropdown lists.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });
  useEffect(() => {
    const onResize = () => {
      const panel = ref.current;
      const opener = openerIn(anchor.current);
      if (panel && opener) placeMenu(panel, opener);
    };
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) latestClose.current();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor]);

  const keys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const choices = [...e.currentTarget.querySelectorAll<HTMLElement>(CHOICES)];
    const at = choices.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => choices[(i + choices.length) % choices.length]?.focus({ preventScroll: true });
    switch (e.key) {
      case "ArrowDown":
        go(at + 1);
        break;
      case "ArrowUp":
        go(at < 0 ? -1 : at - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(-1);
        break;
      case "Tab":
        // On from the button, as if the menu had never been opened.
        openerIn(anchor.current)?.focus({ preventScroll: true });
        onClose();
        return;
      default:
        return;
    }
    // The arrows move between choices only, never the page or the row under it.
    e.preventDefault();
    e.stopPropagation();
  };

  const picked = (e: ReactMouseEvent<HTMLDivElement>) => {
    onClickCapture?.(e);
    if ((e.target as Element).closest?.(CHOICES)) openerIn(anchor.current)?.focus({ preventScroll: true });
  };

  return floatingPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      {...rest}
      onKeyDown={keys}
      onClickCapture={picked}
      className={`ta-scroll ${styles.panel} ${styles.popover}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>,
  );
}
