"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Wraps rows that are about to be replaced, while a filter, a search or a
 * page of results is on its way. They stay put, so nothing jumps, fade back
 * after a moment, and are announced busy. Pass the transition's isPending,
 * or useNavigationPending() when the change goes through the address.
 */
export function PendingRegion({
  pending,
  children,
  className = "",
  style,
}: {
  pending: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`ta-pending-region ${className}`.trim()} aria-busy={pending || undefined} style={style}>
      {children}
    </div>
  );
}
