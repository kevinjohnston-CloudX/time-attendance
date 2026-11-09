"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Printer, RefreshCw, UserPlus, X } from "lucide-react";
import { Banner, Button, Input } from "@/components/ui";
import { Overlay } from "@/components/ui/overlay";
import { createVisitor, getNewVisitorData, renewVisitorPass, searchVisitorHosts, searchVisitors } from "@/actions/visitor.actions";
import {
  DEFAULT_VISITOR_TERM,
  VISITOR_KIND_LABEL,
  VISITOR_TERMS,
  VISITOR_TERM_LABEL,
  lastDayOf,
  renewalStart,
  type VisitorKind,
  type VisitorTerm,
} from "@/lib/visitors/visitor-pass";
import type { AddedVisitor, HostMatch, VisitorBadge, VisitorMatch } from "@/lib/visitors/visitors.service";
import { qrPath } from "@/lib/badge/qr-path";
import frame from "./export-window.module.css";
import styles from "./new-visitor-window.module.css";
import { BadgeSample } from "./badge-sample";
import { PrintBadgeWindow } from "./print-badge-window";

/**
 * New visitor on Live Attendance (src/lib/visitors), on the Export window's
 * frame. One shape from start to finish: the form on the left (Visitor
 * details, then Pass), the badge exactly as it prints on the right with what
 * it will say about the building and dates. Choosing a pass, renewing and the
 * result after saving all happen inside that shape, so nothing moves.
 *
 * <p>The pass is one choice, not two: a grid of the six lengths in two rows,
 * Day pass and Frequent visitor, so the kind follows from the length.
 *
 * <p>A visitor who has been here before is renewed, not added twice: as the
 * name is typed, earlier visitors with that name drop down under it, each
 * with Renew.
 */

const dayLong = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** A calendar day as people read it: "Fri, Nov 6, 2026". */
export function dayWords(d: string): string {
  return dayLong.format(new Date(`${d}T00:00:00.000Z`));
}

/** Today on the building's calendar. */
function todayAt(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

const KINDS: VisitorKind[] = ["DAY_PASS", "FREQUENT"];

/** Waits until typing stops before asking the server. */
function useSearch<T>(text: string, run: (q: string) => Promise<T[]>): T[] {
  const [found, setFound] = useState<T[]>([]);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    const q = text.trim();
    let live = true;
    const t = setTimeout(
      async () => {
        const rows = q.length < 2 ? [] : await runRef.current(q).catch(() => []);
        if (live) setFound(rows);
      },
      q.length < 2 ? 0 : 250,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text]);
  return found;
}

/** A value held back until it stops changing, so the badge does not redraw on every key. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function standing(m: VisitorMatch): { text: string; tone: "ok" | "warn" | "off" } {
  switch (m.standing) {
    case "VALID":
    case "NOT_YET":
      return { text: `Active until ${dayWords(m.validUntil!)}`, tone: "ok" };
    case "EXPIRED":
      return { text: `Expired ${dayWords(m.validUntil!)}`, tone: "warn" };
    case "ENDED":
      return { text: "Access ended", tone: "off" };
    case "OTHER_BUILDING":
      return { text: "Other building", tone: "off" };
    case "NO_PASS":
      return { text: "No expiry", tone: "ok" };
  }
}

export function NewVisitorWindow({
  site,
  renew,
  onDone,
  onClose,
}: {
  site: { id: string; name: string; timezone: string };
  /** Opens on this visitor, ready to renew (from the gate alert or the Visitors list). */
  renew?: VisitorMatch;
  /** Told when a visitor is added or renewed, before the window shows its result. */
  onDone?: (result: AddedVisitor & { renewed: boolean }) => void;
  onClose: () => void;
}) {
  const [setup, setSetup] = useState<{ missing: string | null; nextBadge: string; companies: string[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<VisitorMatch | null>(renew ?? null);
  const [name, setName] = useState("");
  const [nameFocus, setNameFocus] = useState(false);
  const [company, setCompany] = useState("");
  const [hostText, setHostText] = useState("");
  const [host, setHost] = useState<HostMatch | null>(null);
  const [hostFocus, setHostFocus] = useState(false);
  const [kind, setKind] = useState<VisitorKind>(renew?.kind ?? "DAY_PASS");
  const [term, setTerm] = useState<VisitorTerm>(DEFAULT_VISITOR_TERM[renew?.kind ?? "DAY_PASS"]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<(AddedVisitor & { renewed: boolean }) | null>(null);
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  useEffect(() => {
    printingRef.current = printing;
  }, [printing]);
  const windowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getNewVisitorData({ siteId: site.id }).then((r) => {
      if (!live) return;
      if (r.success) setSetup(r.data);
      else setLoadError(r.error);
    });
    return () => {
      live = false;
    };
  }, [site.id]);

  // Escape closes, and focus goes back where it came from.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    windowRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // The print window on top answers its own Escape.
      if (e.key !== "Escape" || printingRef.current) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  const matches = useSearch(renewing || done ? "" : name, async (q) => {
    const r = await searchVisitors({ siteId: site.id, q });
    return r.success ? r.data : [];
  });
  const hosts = useSearch(host || renewing ? "" : hostText, async (q) => {
    const r = await searchVisitorHosts({ siteId: site.id, q });
    return r.success ? r.data : [];
  });

  const today = todayAt(site.timezone);
  const pick = (k: VisitorKind, t: VisitorTerm) => {
    setKind(k);
    setTerm(t);
  };

  // When the pass starts: today, or for a renewal that carries on, the day after it would have ended.
  const carriesOn = !!renewing && (renewing.standing === "VALID" || renewing.standing === "NOT_YET") && renewing.siteId === site.id && !!renewing.validUntil;
  const starts = done ? done.validFrom : carriesOn ? renewalStart(renewing!.validUntil!, today) : today;
  const expires = done ? done.validUntil : lastDayOf(term, starts);

  const missing = renewing
    ? []
    : [name.trim().length < 2 && "Full name", !company.trim() && "Company", !host && !hostText.trim() && "Host"].filter(
        (m): m is string => !!m,
      );
  const blocked = !setup || !!setup.missing || !!loadError;

  const startRenew = (m: VisitorMatch) => {
    setRenewing(m);
    setFailure(null);
    setNameFocus(false);
    if (m.kind) pick(m.kind, DEFAULT_VISITOR_TERM[m.kind]);
  };

  const submit = async () => {
    if (busy || blocked || missing.length) return;
    setBusy(true);
    setFailure(null);
    const r = renewing
      ? await renewVisitorPass({ siteId: site.id, employeeId: renewing.id, kind, term })
      : await createVisitor({
          siteId: site.id,
          name: name.trim(),
          company: company.trim(),
          hostEmployeeId: host?.id ?? null,
          hostName: host ? null : hostText.trim() || null,
          kind,
          term,
        });
    setBusy(false);
    if (r.success) {
      const result = { ...r.data, renewed: !!renewing };
      setDone(result);
      onDone?.(result);
    } else setFailure(r.error);
  };

  const another = () => {
    setDone(null);
    setRenewing(null);
    setName("");
    setCompany("");
    setHostText("");
    setHost(null);
    pick("DAY_PASS", DEFAULT_VISITOR_TERM.DAY_PASS);
    getNewVisitorData({ siteId: site.id }).then((r) => r.success && setSetup(r.data));
  };

  // What the badge says: the saved one after saving, otherwise what it will say.
  const shownName = done?.name ?? renewing?.name ?? name.trim();
  const shownCompany = renewing ? renewing.company : company.trim() || null;
  const shownHost = renewing ? null : host?.name ?? (hostText.trim() || null);
  const badgeNumber = done?.badge ?? renewing?.badge ?? setup?.nextBadge ?? "";
  const live = useSettled(
    { name: shownName, company: shownCompany, host: shownHost, badge: badgeNumber, kind: done?.kind ?? kind, term: done?.term ?? term, starts, expires },
    250,
  );
  const sample = useMemo<VisitorBadge | null>(
    () =>
      live.badge
        ? {
            name: live.name || "Visitor name",
            company: live.company,
            visiting: live.host,
            badge: live.badge,
            kind: live.kind,
            term: live.term,
            validFrom: live.starts,
            validUntil: live.expires,
            siteName: site.name,
            photo: null,
            qr: qrPath(live.badge),
          }
        : null,
    [live, site.name],
  );

  const title = done ? (done.renewed ? "Pass renewed" : "Visitor added") : renewing ? "Renew pass" : "New visitor";
  const hint = done
    ? done.renewed
      ? `${done.name}'s badge now works until ${dayWords(done.validUntil)}.`
      : `${done.name} can use badge ${done.badge} from now.`
    : setup?.missing
      ? null
      : missing.length
        ? `Required: ${missing.join(", ")}.`
        : null;

  return (
    <Overlay className={`${frame.scrim} ta-sheet-scrim`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={windowRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-visitor-title"
        className={`${frame.window} ta-sheet ${styles.window}`}
      >
        <header className={frame.head}>
          <span className={frame.glyph} aria-hidden="true">
            {done ? <BadgeCheck /> : renewing ? <RefreshCw /> : <UserPlus />}
          </span>
          <span className={frame.titles}>
            <h2 id="new-visitor-title" className={`${frame.title} truncate`}>
              {title}
            </h2>
            <span className={`${frame.subtitle} truncate`}>{site.name}</span>
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className={`${frame.body} ${styles.body}`}>
          {loadError && <Banner tone="error" title="Visitors could not be opened" body={loadError} />}
          {setup?.missing && (
            <Banner tone="warning" title="Visitors are not set up for this company" body={`Visitors need ${setup.missing}. A System Admin can add it.`} />
          )}
          {failure && <Banner tone="error" title={renewing ? "The pass was not renewed" : "The visitor was not added"} body={failure} />}

          <div className={styles.panes}>
            {/* ── The form ── */}
            <section className={`${frame.card} ${styles.form}`} aria-label={done ? "Saved" : "Visitor and pass"}>
              <div className={styles.section}>
                <h3 className={styles.sectionLabel}>Visitor details</h3>
                {done || renewing ? (
                  <dl className={styles.facts}>
                    <Fact label="Full name" value={shownName} />
                    <Fact label="Company" value={(done ? company.trim() || renewing?.company : renewing?.company) || "Not recorded"} />
                    {done && !done.renewed ? (
                      <Fact label="Host" value={shownHost ?? "Not recorded"} />
                    ) : (
                      <Fact label="Current pass" value={renewing ? standing(renewing).text : "Not recorded"} />
                    )}
                    {renewing && !done && (
                      <div className={styles.factAction}>
                        <Button hierarchy="link" size="sm" onClick={() => setRenewing(null)}>
                          Add a different visitor
                        </Button>
                      </div>
                    )}
                  </dl>
                ) : (
                  <div className={styles.fields}>
                    <div className={styles.anchor}>
                      <Input
                        label="Full name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onFocus={() => setNameFocus(true)}
                        onBlur={() => setTimeout(() => setNameFocus(false), 150)}
                        autoComplete="off"
                        maxLength={100}
                      />
                      {nameFocus && matches.length > 0 && (
                        <div className={styles.menu} role="listbox" aria-label="Previous visits">
                          <span className={styles.menuLabel}>Previous visits</span>
                          {matches.map((m) => {
                            const s = standing(m);
                            return (
                              <div key={m.id} className={styles.match}>
                                <span className={styles.matchText}>
                                  <span className={styles.matchName}>{m.name}</span>
                                  <span className={styles.matchMeta}>{[m.company, m.badge].filter(Boolean).join(", ")}</span>
                                </span>
                                <span className={styles.pill} data-tone={s.tone}>
                                  {s.text}
                                </span>
                                <Button hierarchy="secondary" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => startRenew(m)}>
                                  Renew
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <Input label="Company" value={company} onChange={(e) => setCompany(e.target.value)} list="nv-companies" autoComplete="off" maxLength={100} />
                    <datalist id="nv-companies">
                      {setup?.companies.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    <div className={styles.anchor}>
                      <Input
                        label="Host"
                        placeholder="Search employees"
                        hint={host ? (host.department ?? "Employee") : "If they are not listed, type the name."}
                        value={host ? host.name : hostText}
                        onChange={(e) => {
                          setHost(null);
                          setHostText(e.target.value);
                        }}
                        onFocus={() => setHostFocus(true)}
                        onBlur={() => setTimeout(() => setHostFocus(false), 150)}
                        autoComplete="off"
                        maxLength={100}
                      />
                      {hostFocus && !host && hosts.length > 0 && (
                        <div className={`${styles.menu} ${styles.menuHost}`} role="listbox" aria-label="Employees">
                          {hosts.map((h) => (
                            <button
                              key={h.id}
                              type="button"
                              role="option"
                              aria-selected={false}
                              className={styles.option}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setHost(h);
                                setHostText(h.name);
                                setHostFocus(false);
                              }}
                            >
                              <span className={styles.matchName}>{h.name}</span>
                              <span className={styles.matchMeta}>{[h.department, h.here ? null : "Other building"].filter(Boolean).join(", ")}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.section}>
                <h3 className={styles.sectionLabel} id="nv-pass">
                  Pass
                </h3>
                <div role="radiogroup" aria-labelledby="nv-pass" className={styles.passGrid}>
                  {KINDS.map((k) => (
                    <div key={k} className={styles.passRow}>
                      <span className={styles.passKind}>{VISITOR_KIND_LABEL[k]}</span>
                      <span className={styles.passOptions}>
                        {VISITOR_TERMS[k].map((t) => {
                          const on = kind === k && term === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              data-on={on}
                              disabled={!!done || busy}
                              className={styles.passOption}
                              onClick={() => pick(k, t)}
                            >
                              {VISITOR_TERM_LABEL[t]}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── The badge ── */}
            <aside className={`${frame.rail} ${styles.rail}`} aria-label="Badge">
              <div className={styles.badgeWrap}>{sample ? <BadgeSample badge={sample} width={268} /> : <span className={styles.badgeWait} />}</div>
              <dl className={styles.summary}>
                <Fact label="Building" value={site.name} />
                <Fact label="Starts" value={dayWords(starts)} />
                <Fact label="Expires" value={dayWords(expires)} strong />
                <Fact label="Badge number" value={badgeNumber || "Assigned when added"} />
              </dl>
            </aside>
          </div>
        </div>

        <footer className={frame.foot}>
          <span className={frame.footHint} aria-live="polite">
            {hint}
          </span>
          <span className="ta-sheet-actions contents">
            {done ? (
              <>
                <Button hierarchy="tertiary" onClick={onClose}>
                  Close
                </Button>
                <Button hierarchy="secondary" onClick={another}>
                  Add another visitor
                </Button>
                <Button hierarchy="primary" leadingIcon={<Printer className="h-4 w-4" aria-hidden="true" />} onClick={() => setPrinting(true)}>
                  Print badge
                </Button>
              </>
            ) : (
              <>
                <Button hierarchy="tertiary" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button hierarchy="primary" onClick={submit} disabled={busy || blocked || missing.length > 0} pending={busy}>
                  {busy ? (renewing ? "Renewing…" : "Adding…") : renewing ? "Renew pass" : "Add visitor"}
                </Button>
              </>
            )}
          </span>
        </footer>
      </div>
      {printing && done && <PrintBadgeWindow siteId={site.id} employeeId={done.employeeId} name={done.name} onClose={() => setPrinting(false)} />}
    </Overlay>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue} data-strong={strong || undefined}>
        {value}
      </dd>
    </div>
  );
}
