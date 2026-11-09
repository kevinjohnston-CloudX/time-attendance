"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, FileText, Printer, Tag, X, type LucideIcon } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { Overlay } from "@/components/ui/overlay";
import { getVisitorBadgeToPrint } from "@/actions/visitor.actions";
import type { VisitorBadge } from "@/lib/visitors/visitors.service";
import { PAPER_BODY, PAPER_LABEL, badgeSheet, printBadgeSheet, type BadgePaper } from "./visitor-badge-print";
import { BadgeSample } from "./badge-sample";
import frame from "./export-window.module.css";
import styles from "./print-badge-window.module.css";

/**
 * Print badge, from New Visitor's result and the Visitors list: which paper,
 * a preview of exactly what prints, and Print (visitor-badge-print.ts). The
 * paper chosen is remembered on this computer, since a desk's printer does
 * not change between visitors.
 */

const PAPERS: { value: BadgePaper; icon: LucideIcon }[] = [
  { value: "letter", icon: FileText },
  { value: "label", icon: Tag },
  { value: "card", icon: CreditCard },
];

const KEY = "cloudtime.visitorBadgePaper";
function savedPaper(): BadgePaper {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "label" || v === "card" ? v : "letter";
  } catch {
    return "letter";
  }
}

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
    try {
      window.localStorage.setItem(KEY, p);
    } catch {
      // A private window keeps no choice; the default is fine.
    }
  };

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
    printBadgeSheet(badgeSheet(r.data, paper));
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
            <section className={frame.card} aria-labelledby="print-paper">
              <span id="print-paper" className={frame.groupLabel}>
                Paper
              </span>
              <div role="radiogroup" aria-labelledby="print-paper" className={frame.choices}>
                {PAPERS.map(({ value, icon: Icon }) => {
                  const on = paper === value;
                  return (
                    <label key={value} className={frame.choice} data-on={on}>
                      <input type="radio" name="print-paper" value={value} checked={on} onChange={() => pick(value)} className="sr-only" />
                      <span className={frame.choiceIcon} aria-hidden="true">
                        <Icon />
                      </span>
                      <span className={frame.choiceText}>
                        <span className={frame.choiceTitle}>{PAPER_LABEL[value]}</span>
                        <span className={frame.choiceBody}>{PAPER_BODY[value]}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
            <aside className={frame.rail} aria-label="Preview">
              <div className={`${frame.railBlock} ${frame.previewBlock} ${styles.previewBlock}`}>
                {badge ? <BadgeSample badge={badge} paper={paper} width={paper === "card" ? 232 : 248} /> : !failure && <span className={styles.previewWait} />}
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
