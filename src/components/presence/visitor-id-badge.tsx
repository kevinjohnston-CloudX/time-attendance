import { forwardRef } from "react";
import { IdBadge } from "@/components/badge/id-badge";
import type { IdBadge as IdBadgeData } from "@/lib/badge/badge.service";
import type { VisitorBadge } from "@/lib/visitors/visitors.service";
import { badgeBand } from "./visitor-badge-print";

/**
 * A visitor's Badge: the employee ID badge itself (My Badge), the same layout
 * and size, with the visitor's details and the pass's colour (Juan,
 * 2026-11-17). The company sits where a job title would, then the one
 * building the pass opens, then its last day. Printed by printIdBadge like an
 * employee's, so the two can never drift apart.
 */

const untilWords = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The card is laid out at My Badge's own width, then scaled. */
export const ID_BADGE_WIDTH = 400;
/** A CR80 card standing up: height over width. */
export const ID_BADGE_RATIO = 3.375 / 2.125;

function asIdBadge(b: VisitorBadge, draft: boolean): IdBadgeData {
  return {
    kind: "VISITOR",
    name: b.name.trim() || (draft ? "Full name" : b.badge),
    jobTitle: b.company?.trim() || (draft ? "Company" : null),
    site: b.siteName,
    number: b.badge,
    photo: b.photo,
    active: true,
    qr: b.qr,
  };
}

/**
 * The badge at `width` pixels wide. The ref is the card itself, at its own
 * 400px, which is what printIdBadge copies onto the paper.
 */
export const VisitorIdBadge = forwardRef<HTMLDivElement, { badge: VisitorBadge; width: number; draft?: boolean }>(
  function VisitorIdBadge({ badge, width, draft = false }, ref) {
    const zoom = width / ID_BADGE_WIDTH;
    return (
      <div style={{ width }}>
        <div ref={ref} style={{ width: ID_BADGE_WIDTH, zoom }}>
          <IdBadge
            badge={asIdBadge(badge, draft)}
            until={untilWords.format(new Date(`${badge.validUntil}T00:00:00.000Z`))}
            tone={badgeBand(badge.kind, badge.term)}
          />
        </div>
      </div>
    );
  },
);
