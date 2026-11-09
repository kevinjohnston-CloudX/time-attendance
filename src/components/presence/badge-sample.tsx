"use client";

import type { VisitorBadge } from "@/lib/visitors/visitors.service";
import { badgeSheet, type BadgePaper } from "./visitor-badge-print";
import styles from "./badge-sample.module.css";

/**
 * The printed badge itself, scaled to fit, for New Visitor and Print badge:
 * the same page the printer gets (visitor-badge-print.ts), so what is shown
 * is what prints. Drawn in a frame of its own so the badge's styles never
 * meet the app's, and with no scripts allowed in it.
 */

/** The paper's size in CSS pixels at 96 per inch. */
const SIZE: Record<Exclude<BadgePaper, "letter">, { w: number; h: number }> = {
  label: { w: 384, h: 288 },
  card: { w: 324, h: 204 },
};

export function BadgeSample({ badge, paper = "label", width }: { badge: VisitorBadge; paper?: BadgePaper; width: number }) {
  const shown = paper === "letter" ? "label" : paper;
  const { w, h } = SIZE[shown];
  const scale = width / w;
  return (
    <div className={styles.sample} style={{ width, height: Math.round(h * scale) }}>
      <iframe
        title="Badge preview"
        tabIndex={-1}
        sandbox=""
        srcDoc={badgeSheet(badge, shown)}
        className={styles.frame}
        style={{ width: w, height: h, transform: `scale(${scale})` }}
      />
    </div>
  );
}
