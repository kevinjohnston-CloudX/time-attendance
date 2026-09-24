"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * The last step of the breadcrumb on a record page: the record's own name.
 *
 * <p>The top bar builds its trail from the nav model, which knows sections
 * and pages but not that /admin/employees/abc123 is Aarif Saed. The record
 * page knows, so it hands the name over with useBreadcrumbLeaf. The name is
 * kept with the path it was set on, so a name from the page you just left
 * can never show on the next one while it loads.
 */
type Leaf = { path: string; label: string } | null;

let leaf: Leaf = null;
const listeners = new Set<() => void>();

function set(next: Leaf) {
  leaf = next;
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** A record page names itself in the breadcrumb for as long as it is open. */
export function useBreadcrumbLeaf(label: string | null | undefined) {
  useEffect(() => {
    if (!label) return;
    const mine = { path: window.location.pathname, label };
    set(mine);
    return () => {
      if (leaf === mine) set(null);
    };
  }, [label]);
}

/** The leaf for this path, if the page on it has named one. */
export function useBreadcrumbLeafFor(pathname: string): string | null {
  const current = useSyncExternalStore(
    subscribe,
    () => leaf,
    () => null,
  );
  return current && current.path === pathname ? current.label : null;
}
