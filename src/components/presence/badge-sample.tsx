"use client";

import type { VisitorBadge } from "@/lib/visitors/visitors.service";
import { PAPER_CORNER_PX, badgeSheet, type BadgePaper } from "./visitor-badge-print";
import styles from "./badge-sample.module.css";

/**
 * The printed badge itself, scaled to fit, for New Visitor and Print badge:
 * the badge exactly as it sits on the page the printer gets
 * (visitor-badge-print.ts), on the paper chosen, with that paper's corner and
 * cut line. Nothing is drawn on top, so what is shown is what prints.
 *
 * <p>Drawn in a frame of its own so the badge's styles never meet the app's.
 * The frame runs no scripts; it shares the app's address only so it can load
 * the badge's typeface.
 */

/** The badge's size in CSS pixels at 96 per inch. */
const SIZE: Record<BadgePaper, { w: number; h: number }> = {
  letter: { w: 384, h: 288 },
  label: { w: 384, h: 288 },
  card: { w: 324, h: 204 },
};

export function badgeSampleHeight(paper: BadgePaper, width: number): number {
  return Math.round((SIZE[paper].h * width) / SIZE[paper].w);
}

export function BadgeSample({
  badge,
  paper,
  width,
  draft = false,
}: {
  badge: VisitorBadge;
  paper: BadgePaper;
  width: number;
  /** Not saved yet: empty fields show as grey stand ins. */
  draft?: boolean;
}) {
  const { w, h } = SIZE[paper];
  const scale = width / w;
  return (
    <div
      className={styles.sample}
      data-paper={paper}
      style={{ width, height: badgeSampleHeight(paper, width), borderRadius: PAPER_CORNER_PX[paper] * scale }}
    >
      <iframe
        title="Badge preview"
        tabIndex={-1}
        sandbox="allow-same-origin"
        srcDoc={badgeSheet(badge, paper, { only: "badge", draft })}
        className={styles.frame}
        style={{ width: w, height: h, transform: `scale(${scale})` }}
      />
    </div>
  );
}
