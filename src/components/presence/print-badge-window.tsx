"use client";

import { useEffect, useRef, useState } from "react";
import { IdCard, Printer, Tag, X, type LucideIcon } from "lucide-react";
import { Banner, Button, SegmentedControl } from "@/components/ui";
import { Overlay } from "@/components/ui/overlay";
import { getVisitorBadgeToPrint } from "@/actions/visitor.actions";
import type { VisitorBadge } from "@/lib/visitors/visitors.service";
import { badgeSheet, isBadgePaper, printBadgeSheet, rememberPaper, savedPaper, type BadgePaper } from "./visitor-badge-print";
import { printIdBadge } from "@/components/badge/print-id-badge";
import { BadgeSample } from "./badge-sample";
import { VisitorIdBadge, shapeFor, sizeFor } from "./visitor-id-badge";
import frame from "./export-window.module.css";
import styles from "./print-badge-window.module.css";

/**
 * Print badge, from New Visitor's result and the Visitors list: which version,
 * the badge exactly as it prints, and Print. Two versions (Juan, 2026-11-17):
 * the Badge, the employee ID badge with the visitor's details and colour, on
 * letter paper or an ID card; and the label, until the shirt sticker's size is
 * confirmed. The choice is remembered on this computer, and New Visitor
 * previews the badge as it will print.
 */

type Version = "badge" | "label";

const VERSIONS: { value: Version; icon: LucideIcon; title: string; body: string }[] = [
  { value: "badge", icon: IdCard, title: "Badge", body: "Same layout as an employee badge" },
  { value: "label", icon: Tag, title: "Label", body: "Label printer, 4 × 3 in labels" },
];

const PRINT_ON: { value: "letter" | "card"; label: string; hint: string }[] = [
  { value: "letter", label: "Letter paper", hint: "Office printer. A 3 × 4 in badge to cut out for a lanyard holder." },
  { value: "card", label: "ID card", hint: "Card printer, standard ID cards (CR80)." },
];

/** The Badge's width in the preview, by shape, so both stand about as tall in the rail. */
const PREVIEW_BADGE_WIDTH = { "3x4": 232, card: 196 } as const;

export function PrintBadgeWindow({
  siteId,
  employeeId,
  name,
  onClose,
}: {
  siteId: string;
  employeeId: string;
  name: string;
  onClose: () => void;
}) {
  const [paper, setPaper] = useState<BadgePaper>(() => (typeof window === "undefined" ? "letter" : savedPaper()));
  const [badge, setBadge] = useState<VisitorBadge | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getVisitorBadgeToPrint({ siteId, employeeId, paper: "letter", printing: false })
      .then((r) => {
        if (!live) return;
        if (r.success) setBadge(r.data);
        else setFailure(r.error);
      })
      .catch(() => live && setFailure("The badge could not be loaded. Check the connection and try again."));
    return () => {
      live = false;
    };
  }, [siteId, employeeId]);

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    windowRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  const pick = (p: BadgePaper) => {
    setPaper(p);
    rememberPaper(p);
  };
  // The Badge's paper is kept while the label is chosen, so going back finds it.
  const [badgePaper, setBadgePaper] = useState<"letter" | "card">(() => (isBadgePaper(paper) ? paper : "letter"));
  const version: Version = isBadgePaper(paper) ? "badge" : "label";
  const pickVersion = (v: Version) => pick(v === "badge" ? badgePaper : "label");
  const pickBadgePaper = (p: "letter" | "card") => {
    setBadgePaper(p);
    pick(p);
  };
  const cardRef = useRef<HTMLDivElement>(null);

  const print = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    // Asked again so the print is recorded, with the paper it went to.
    const r = await getVisitorBadgeToPrint({ siteId, employeeId, paper, printing: true }).catch(() => null);
    setBusy(false);
    if (!r || !r.success) {
      setFailure(r && !r.success ? r.error : "The badge could not be printed. Check the connection and try again.");
      return;
    }
    if (isBadgePaper(paper)) {
      const card = cardRef.current?.firstElementChild;
      if (card instanceof HTMLElement) printIdBadge(card, paper, sizeFor(paper));
    } else {
      printBadgeSheet(badgeSheet(r.data, paper));
    }
  };

  return (
    <Overlay className={`${frame.scrim} ta-sheet-scrim`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={windowRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="print-badge-title" className={`${frame.window} ta-sheet ${styles.window}`}>
        <header className={frame.head}>
          <span className={frame.glyph} aria-hidden="true">
            <Printer />
          </span>
          <span className={frame.titles}>
            <h2 id="print-badge-title" className={`${frame.title} truncate`}>
              Print badge
            </h2>
            <span className={`${frame.subtitle} truncate`}>{badge ? `${badge.name}, ${badge.badge}` : name}</span>
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className={frame.body}>
          {failure && <Banner tone="error" title="The badge could not be printed" body={failure} />}
          <div className={frame.panes}>
            <section className={frame.card} aria-labelledby="print-version">
              <div className={`${frame.group} ${styles.block}`}>
                <span id="print-version" className={frame.groupLabel}>
                  Version
                </span>
                <div role="radiogroup" aria-labelledby="print-version" className={frame.choices}>
                  {VERSIONS.map(({ value, icon: Icon, title, body }) => {
                    const on = version === value;
                    return (
                      <label key={value} className={frame.choice} data-on={on}>
                        <input type="radio" name="print-version" value={value} checked={on} onChange={() => pickVersion(value)} className="sr-only" />
                        <span className={frame.choiceIcon} aria-hidden="true">
                          <Icon />
                        </span>
                        <span className={frame.choiceText}>
                          <span className={frame.choiceTitle}>{title}</span>
                          <span className={frame.choiceBody}>{body}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className={`${frame.group} ${styles.block}`}>
                <span id="print-on" className={frame.groupLabel}>
                  Print on
                </span>
                {version === "badge" ? (
                  <>
                    <SegmentedControl
                      ariaLabel="Print on"
                      fullWidth
                      items={PRINT_ON.map(({ value, label }) => ({ value, label }))}
                      value={badgePaper}
                      onChange={(v) => pickBadgePaper(v as "letter" | "card")}
                    />
                    <p className={styles.hint}>{PRINT_ON.find((o) => o.value === badgePaper)!.hint}</p>
                  </>
                ) : (
                  <p className={styles.hint}>A 4 × 3 in label, one per visitor.</p>
                )}
              </div>
            </section>
            <aside className={frame.rail} aria-label="Preview">
              <div className={`${frame.railBlock} ${frame.previewBlock} ${styles.previewBlock}`}>
                {badge ? (
                  version === "badge" ? (
                    <VisitorIdBadge ref={cardRef} badge={badge} width={PREVIEW_BADGE_WIDTH[shapeFor(badgePaper)]} shape={shapeFor(badgePaper)} />
                  ) : (
                    <BadgeSample badge={badge} paper="label" width={248} />
                  )
                ) : (
                  !failure && <span className={styles.previewWait} data-version={version} />
                )}
              </div>
            </aside>
          </div>
        </div>

        <footer className={frame.foot}>
          <span className={frame.footHint}>In the print dialog, set Scale to 100%.</span>
          <span className="ta-sheet-actions contents">
            <Button hierarchy="tertiary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              hierarchy="primary"
              leadingIcon={<Printer className="h-4 w-4" aria-hidden="true" />}
              onClick={() => void print()}
              disabled={busy || !badge}
              pending={busy}
            >
              Print badge
            </Button>
          </span>
        </footer>
      </div>
    </Overlay>
  );
}
