"use client";

import { useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import styles from "./menu.module.css";

/**
 * The shared menu: the account menu's look, for every pop over that drops
 * from a button (row actions, the Building menu, View options). The caller
 * places the panel; these draw what is inside it, the same everywhere.
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
 * Closes an open menu on Escape or a press anywhere outside `ref`, and puts
 * focus back on the button that opened it (the one marked expanded) after
 * Escape. Escape is taken
 * before a window under the menu hears it, so it closes the menu only.
 */
export function useMenuDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      ref.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, ref]);
}
