"use client";

import { useState } from "react";
import { Ban, Printer, RefreshCw } from "lucide-react";
import { Badge, Button, ConfirmDialog } from "@/components/ui";
import { endVisitor } from "@/actions/visitor.actions";
import type { PresenceDetail } from "@/lib/presence/types";
import { VISITOR_KIND_LABEL, VISITOR_TERM_LABEL, type PassStanding } from "@/lib/visitors/visitor-pass";
import { NewVisitorWindow } from "./new-visitor-window";
import { PrintBadgeWindow } from "./print-badge-window";
import styles from "./on-site.module.css";

/**
 * A visitor's pass in their details panel, and what loss prevention does
 * with it: renew, print the badge, end access. The same actions as the
 * Visitors window, from the visitor's own row, so looking after a visitor
 * no longer means finding them again in a list.
 *
 * <p>Everyone who can see Live Attendance sees the pass. The buttons are
 * drawn only for viewers with the Visitors permission (`site` is set), and
 * every action checks that permission again on the server.
 */

type Pass = NonNullable<PresenceDetail["visitorPass"]>;

const dayShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function when(d: string, today: string): string {
  return (d.slice(0, 4) === today.slice(0, 4) ? dayShort : dayYear).format(new Date(`${d}T00:00:00.000Z`));
}

function standingBadge(p: Pass, today: string): { tone: "success" | "warning" | "neutral" | "error"; text: string } {
  const s: PassStanding = p.standing;
  if (s === "VALID") return p.validUntil === today ? { tone: "warning", text: "Ends today" } : { tone: "success", text: "Allowed in" };
  if (s === "NOT_YET") return { tone: "neutral", text: `Starts ${when(p.validFrom, today)}` };
  if (s === "EXPIRED") return { tone: "warning", text: "Expired" };
  if (s === "ENDED") return { tone: "error", text: "Access ended" };
  return { tone: "neutral", text: "Another building" };
}

export function VisitorPassSection({
  pass,
  employeeId,
  name,
  badge,
  today,
  site,
  onChanged,
}: {
  pass: Pass | null;
  employeeId: string;
  name: string;
  badge: string;
  today: string;
  /** This building, when the viewer may manage visitors; null hides the buttons. */
  site: { id: string; name: string; timezone: string } | null;
  /** After a renew or an end: a line to show, and the details read again. */
  onChanged: (message: string) => void;
}) {
  const [renewing, setRenewing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endNow = async () => {
    if (!site || busy) return;
    setBusy(true);
    setError(null);
    const r = await endVisitor({ siteId: site.id, employeeId }).catch(() => null);
    setBusy(false);
    if (r?.success) {
      setEnding(false);
      onChanged(`${name}'s access ended`);
    } else setError(r && !r.success ? r.error : "Access could not be ended. Try again.");
  };

  const status = pass ? standingBadge(pass, today) : null;
  const canEnd = !!pass && (pass.standing === "VALID" || pass.standing === "NOT_YET");

  return (
    <section className={styles.ppSection} aria-label="Visitor pass">
      <div className={styles.ppSectionHead}>
        <h3 className={styles.ppTitle}>Visitor pass</h3>
        {status && (
          <Badge tone={status.tone} size="sm">
            {status.text}
          </Badge>
        )}
      </div>

      {pass ? (
        <dl className={styles.vpFacts}>
          <div className={styles.ppFact}>
            <dt>Pass</dt>
            <dd>
              {VISITOR_KIND_LABEL[pass.kind]}, {VISITOR_TERM_LABEL[pass.term].toLowerCase()}
            </dd>
          </div>
          <div className={styles.ppFact}>
            <dt>Valid</dt>
            <dd className="tabular">
              {pass.validFrom === pass.validUntil ? when(pass.validFrom, today) : `${when(pass.validFrom, today)} – ${when(pass.validUntil, today)}`}
            </dd>
          </div>
          <div className={styles.ppFact}>
            <dt>Building</dt>
            <dd title={pass.siteName}>{pass.siteName}</dd>
          </div>
          <div className={styles.ppFact}>
            <dt>Badge</dt>
            <dd className="tabular">{badge}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.vpLine}>This badge has no visitor pass, so the gate lets it in without dates or a building.</p>
      )}

      {site && pass && (
        <div className={styles.vpActions}>
          <Button hierarchy="secondary" size="sm" onClick={() => setRenewing(true)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {pass.standing === "OTHER_BUILDING" ? "Renew here" : "Renew"}
          </Button>
          <Button hierarchy="secondary" size="sm" onClick={() => setPrinting(true)}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print badge
          </Button>
          {canEnd && (
            <Button hierarchy="tertiary" size="sm" onClick={() => setEnding(true)}>
              <Ban className="h-4 w-4" aria-hidden="true" />
              End access
            </Button>
          )}
        </div>
      )}

      {renewing && site && pass && (
        <NewVisitorWindow
          site={site}
          renew={{
            id: employeeId,
            name,
            badge,
            company: pass.company,
            siteId: site.id,
            siteName: site.name,
            standing: pass.standing,
            kind: pass.kind,
            validUntil: pass.validUntil,
            isActive: true,
          }}
          onDone={(result) => onChanged(result.renewed ? `${result.name}'s pass renewed` : `${result.name} added, badge ${result.badge}`)}
          onClose={() => setRenewing(false)}
        />
      )}
      {printing && site && <PrintBadgeWindow siteId={site.id} employeeId={employeeId} name={name} onClose={() => setPrinting(false)} />}
      {ending && site && (
        <ConfirmDialog
          title={`End ${name}'s access?`}
          confirmLabel="End access now"
          pendingLabel="Ending…"
          tone="warning"
          pending={busy}
          error={error}
          onConfirm={() => void endNow()}
          onCancel={() => {
            setEnding(false);
            setError(null);
          }}
        >
          The badge stops working at {site.name} immediately. A visitor already inside can still leave. You can renew the pass later.
        </ConfirmDialog>
      )}
    </section>
  );
}
