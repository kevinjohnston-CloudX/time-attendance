"use client";

import type { ReactNode } from "react";
import { Window } from "@/components/ui";

/**
 * A window over Live Attendance about the building on screen: Tablets, Gate
 * alerts and Terminated employee alerts. The shared window (ui/window.tsx),
 * at the width the caller sets, with Close as its only button, since these
 * show and switch rather than collect. The cards inside use styles.card from
 * building-windows.module.css.
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
  return (
    <Window title={title} subtitle={subtitle} icon={icon} width={width} foot={foot} flush={flush} onClose={onClose}>
      {flush ? <div style={{ display: "flex", minHeight: 0, flexDirection: "column", height: "min(640px, calc(100dvh - 160px))" }}>{children}</div> : children}
    </Window>
  );
}
