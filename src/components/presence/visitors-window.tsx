"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer, RefreshCw, Search, UserPlus, UsersRound, X } from "lucide-react";
import { Banner, Button, ConfirmDialog, Input, SegmentedControl } from "@/components/ui";
import { Overlay } from "@/components/ui/overlay";
import { endVisitor, getSiteVisitors } from "@/actions/visitor.actions";
import { VISITOR_KIND_LABEL, VISITOR_TERM_LABEL, addDays } from "@/lib/visitors/visitor-pass";
import type { VisitorRow } from "@/lib/visitors/visitors.service";
import { NewVisitorWindow, dayWords } from "./new-visitor-window";
import { PrintBadgeWindow } from "./print-badge-window";
import { fmtTime } from "./presence-meta";
import frame from "./export-window.module.css";
import styles from "./visitors-window.module.css";

/**
 * Visitors on Live Attendance: the building's visitors, with New visitor, and
 * Renew and End access now on each (src/lib/visitors). Built on the Export
 * window's frame. New visitor and Renew open the visitor window in its place,
 * and closing that comes back here with the list read again.
 */

type Filter = "active" | "inside" | "ending" | "expired" | "ended";

/** Ending soon: still good, with a last day in the next week (a day pass ends today). */
const ENDING_DAYS = 7;

function filterOf(row: VisitorRow, today: string): Filter[] {
  const out: Filter[] = [];
  if (row.standing === "VALID" || row.standing === "NOT_YET") out.push("active");
  if (row.lastScan?.direction === "IN") out.push("inside");
  if (row.standing === "VALID" && row.validUntil <= addDays(today, ENDING_DAYS - 1)) out.push("ending");
  if (row.standing === "EXPIRED") out.push("expired");
  if (row.standing === "ENDED") out.push("ended");
  return out;
}

const FILTER_LABEL: Record<Filter, string> = {
  active: "Active",
  inside: "On site",
  ending: "Expiring",
  expired: "Expired",
  ended: "Ended",
};

const EMPTY: Record<Filter, string> = {
  active: "No active visitors.",
  inside: "No visitors on site.",
  ending: "No passes expire in the next 7 days.",
  expired: "No passes expired in the last 30 days.",
  ended: "No access was ended in the last 30 days.",
};

const dayShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** A short date for a list: "Nov 13" this year, "Nov 8, 2027" any other. */
function when(d: string, today: string): string {
  return (d.slice(0, 4) === today.slice(0, 4) ? dayShort : dayYear).format(new Date(`${d}T00:00:00.000Z`));
}

function status(row: VisitorRow, today: string): { text: string; tone: "ok" | "warn" | "off" } {
  switch (row.standing) {
    case "VALID":
      return row.validUntil === today ? { text: "Expires today", tone: "warn" } : { text: `Until ${when(row.validUntil, today)}`, tone: "ok" };
    case "NOT_YET":
      return { text: `Starts ${when(row.validFrom, today)}`, tone: "ok" };
    case "EXPIRED":
      return { text: `Expired ${when(row.validUntil, today)}`, tone: "warn" };
    case "ENDED":
      return { text: "Access ended", tone: "off" };
    default:
      return { text: "Other building", tone: "off" };
  }
}

export function VisitorsWindow({
  site,
  onChanged,
  onClose,
}: {
  site: { id: string; name: string; timezone: string };
  /** Told after a visitor is added, renewed or ended, with a line to show. */
  onChanged?: (message: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ today: string; rows: VisitorRow[]; capped: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<{ renew?: VisitorRow } | null>(null);
  const [ending, setEnding] = useState<VisitorRow | null>(null);
  const [printing, setPrinting] = useState<VisitorRow | null>(null);
  const [endBusy, setEndBusy] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  const fetchList = useCallback(() => getSiteVisitors({ siteId: site.id }).catch(() => null), [site.id]);
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchList>>) => {
    if (!r) return setLoadError("Visitors could not be loaded. Check the connection and try again.");
    if (r.success) {
      setData(r.data);
      setLoadError(null);
    } else setLoadError(r.error);
  }, []);
  const load = useCallback(async () => apply(await fetchList()), [apply, fetchList]);

  useEffect(() => {
    let live = true;
    fetchList().then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [fetchList, apply]);

  // Escape closes (unless the visitor window or a confirm is on top), and
  // focus goes back where it came from.
  const closeRef = useRef(onClose);
  const topRef = useRef(false);
  useEffect(() => {
    closeRef.current = onClose;
    topRef.current = !form && !ending && !printing;
  });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    windowRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !topRef.current) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  const today = data?.today ?? "";
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { active: 0, inside: 0, ending: 0, expired: 0, ended: 0 };
    for (const r of data?.rows ?? []) for (const f of filterOf(r, today)) c[f] += 1;
    return c;
  }, [data, today]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) =>
        filterOf(r, today).includes(filter) &&
        (!needle || [r.name, r.company, r.badge, r.visiting].some((v) => v?.toLowerCase().includes(needle))),
    );
  }, [data, today, filter, q]);

  const endNow = async () => {
    if (!ending || endBusy) return;
    setEndBusy(true);
    setEndError(null);
    const r = await endVisitor({ siteId: site.id, employeeId: ending.employeeId }).catch(() => null);
    setEndBusy(false);
    if (r?.success) {
      onChanged?.(`${ending.name}'s access ended`);
      setEnding(null);
      void load();
    } else setEndError(r && !r.success ? r.error : "Access could not be ended. Try again.");
  };

  if (form) {
    const r = form.renew;
    return (
      <NewVisitorWindow
        site={site}
        renew={
          r
            ? {
                id: r.employeeId,
                name: r.name,
                badge: r.badge,
                company: r.company,
                siteId: site.id,
                siteName: site.name,
                standing: r.standing,
                kind: r.kind,
                validUntil: r.validUntil,
                isActive: true,
              }
            : undefined
        }
        onDone={(result) => onChanged?.(result.renewed ? `${result.name}'s pass renewed` : `${result.name} added, badge ${result.badge}`)}
        onClose={() => {
          setForm(null);
          void load();
        }}
      />
    );
  }

  return (
    <Overlay className={`${frame.scrim} ta-sheet-scrim`} onClick={(e) => e.target === e.currentTarget && !ending && onClose()}>
      <div ref={windowRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="visitors-title" className={`${frame.window} ta-sheet`}>
        <header className={frame.head}>
          <span className={frame.glyph} aria-hidden="true">
            <UsersRound />
          </span>
          <span className={frame.titles}>
            <h2 id="visitors-title" className={frame.title}>
              Visitors
            </h2>
            <span className={`${frame.subtitle} truncate`}>{site.name}</span>
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className={frame.body}>
          <section className={`${frame.card} ${styles.card}`} aria-labelledby="visitors-title">
            {loadError && <Banner tone="error" title="Visitors could not be loaded" body={loadError} />}
            <div className={styles.tools}>
              <span className={styles.filters}>
                <SegmentedControl
                  ariaLabel="Show"
                  value={filter}
                  onChange={(v) => setFilter(v as Filter)}
                  items={(Object.keys(FILTER_LABEL) as Filter[]).map((f) => ({
                    value: f,
                    label: data ? `${FILTER_LABEL[f]} ${counts[f]}` : FILTER_LABEL[f],
                  }))}
                />
              </span>
              <span className={styles.search}>
                <Input
                  aria-label="Search visitors"
                  placeholder="Name, company or badge"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  leadingIcon={<Search className="h-4 w-4" aria-hidden="true" />}
                  size="sm"
                />
              </span>
            </div>

            {!data && !loadError ? (
              <div className={styles.rows} aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className={`${styles.row} ${styles.skeleton}`} />
                ))}
              </div>
            ) : shown.length === 0 ? (
              <p className={styles.empty}>{q.trim() ? `No visitors match "${q.trim()}".` : EMPTY[filter]}</p>
            ) : (
              <ul className={styles.rows}>
                {shown.map((r) => {
                  const s = status(r, today);
                  const inside = r.lastScan?.direction === "IN";
                  return (
                    <li key={r.employeeId} className={styles.row}>
                      <span className={styles.who}>
                        <span className={styles.name}>{r.name}</span>
                        <span className={styles.meta}>{[r.company, r.badge].filter(Boolean).join(", ")}</span>
                      </span>
                      <span className={styles.col}>
                        <span className={styles.colLabel}>Host</span>
                        <span className={styles.colValue}>{r.visiting ?? "Not recorded"}</span>
                      </span>
                      <span className={styles.col}>
                        <span className={styles.colLabel}>
                          {VISITOR_KIND_LABEL[r.kind]}, {VISITOR_TERM_LABEL[r.term].toLowerCase()}
                        </span>
                        <span className={styles.pill} data-tone={s.tone}>
                          {s.text}
                        </span>
                      </span>
                      <span className={styles.col}>
                        <span className={styles.colLabel}>Last scan</span>
                        <span className={styles.colValue} data-inside={inside || undefined}>
                          {r.lastScan ? `${inside ? "In at" : "Out at"} ${fmtTime(r.lastScan.at, site.timezone)}` : "No scans yet"}
                        </span>
                      </span>
                      <span className={styles.actions}>
                        <Button hierarchy="secondary" size="sm" leadingIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={() => setForm({ renew: r })}>
                          Renew
                        </Button>
                        {r.standing !== "ENDED" && r.standing !== "EXPIRED" && (
                          <>
                            <Button hierarchy="secondary" size="sm" iconOnly aria-label={`Print ${r.name}'s badge`} title="Print badge" onClick={() => setPrinting(r)}>
                              <Printer className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button hierarchy="tertiary" size="sm" onClick={() => setEnding(r)}>
                              End access
                            </Button>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {data?.capped && <p className={frame.railNote}>Showing the first 500. Search to find someone further down.</p>}
          </section>
        </div>

        <footer className={frame.foot}>
          <span className={frame.footHint}>Expired and ended passes are kept for 30 days.</span>
          <span className="ta-sheet-actions contents">
            <Button hierarchy="tertiary" onClick={onClose}>
              Close
            </Button>
            <Button hierarchy="primary" leadingIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setForm({})}>
              New visitor
            </Button>
          </span>
        </footer>
      </div>

      {printing && (
        <PrintBadgeWindow siteId={site.id} employeeId={printing.employeeId} name={printing.name} onClose={() => setPrinting(null)} />
      )}

      {ending && (
        <ConfirmDialog
          title={`End ${ending.name}'s access?`}
          confirmLabel="End access now"
          pendingLabel="Ending…"
          tone="warning"
          pending={endBusy}
          error={endError}
          onConfirm={() => void endNow()}
          onCancel={() => {
            setEnding(null);
            setEndError(null);
          }}
        >
          The badge stops working at {site.name} immediately. A visitor already inside can still leave. You can renew the pass later.
        </ConfirmDialog>
      )}
    </Overlay>
  );
}
