"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BadgeCheck, CalendarDays, CircleCheck, RefreshCw, Repeat, UserPlus, X, type LucideIcon } from "lucide-react";
import { Banner, Button, Input, SegmentedControl } from "@/components/ui";
import { Overlay } from "@/components/ui/overlay";
import { createVisitor, getNewVisitorData, renewVisitorPass, searchVisitorHosts, searchVisitors } from "@/actions/visitor.actions";
import { DEFAULT_VISITOR_TERM, VISITOR_KIND_LABEL, VISITOR_TERMS, VISITOR_TERM_LABEL, lastDayOf, type VisitorKind, type VisitorTerm } from "@/lib/visitors/visitor-pass";
import type { AddedVisitor, HostMatch, VisitorMatch } from "@/lib/visitors/visitors.service";
import frame from "./export-window.module.css";
import styles from "./new-visitor-window.module.css";

/**
 * New Visitor on Live Attendance: loss prevention adds a visitor at the
 * building on screen, and the badge works at that building's gate until the
 * pass ends (src/lib/visitors). Built on the Export window's frame: the
 * visitor in a card on the left, the pass in a rail on the right with a
 * preview of the badge.
 *
 * <p>Somebody who has been before is renewed, not added twice: as the name is
 * typed, earlier visitors with that name are listed under it, each with
 * Renew.
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

const KIND_ICON: Record<VisitorKind, LucideIcon> = { FREQUENT: Repeat, DAY_PASS: CalendarDays };
const KIND_BODY: Record<VisitorKind, string> = {
  FREQUENT: "Renewable, up to 2 years",
  DAY_PASS: "A day, a week or a month",
};

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

const standingWords = (m: VisitorMatch): { text: string; tone: "ok" | "warn" | "off" } => {
  switch (m.standing) {
    case "VALID":
    case "NOT_YET":
      return { text: `Active through ${dayWords(m.validUntil!)}`, tone: "ok" };
    case "EXPIRED":
      return { text: `Expired ${dayWords(m.validUntil!)}`, tone: "warn" };
    case "ENDED":
      return { text: "Access ended", tone: "off" };
    case "OTHER_BUILDING":
      return { text: "Another building", tone: "off" };
    case "NO_PASS":
      return { text: "No end date", tone: "ok" };
  }
};

export function NewVisitorWindow({
  site,
  onClose,
}: {
  site: { id: string; name: string; timezone: string };
  onClose: () => void;
}) {
  const [setup, setSetup] = useState<{ missing: string | null; nextBadge: string; companies: string[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<VisitorMatch | null>(null);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [hostText, setHostText] = useState("");
  const [host, setHost] = useState<HostMatch | null>(null);
  const [hostFocus, setHostFocus] = useState(false);
  const [kind, setKind] = useState<VisitorKind>("DAY_PASS");
  const [term, setTerm] = useState<VisitorTerm>(DEFAULT_VISITOR_TERM.DAY_PASS);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<(AddedVisitor & { renewed: boolean }) | null>(null);
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
      if (e.key !== "Escape") return;
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
  const pickKind = (k: VisitorKind) => {
    setKind(k);
    setTerm(DEFAULT_VISITOR_TERM[k]);
  };
  const lastDay = useMemo(() => lastDayOf(term, today), [term, today]);

  const missing = renewing
    ? []
    : [
        name.trim().length < 2 && "name",
        !company.trim() && "company",
        !host && !hostText.trim() && "who they are visiting",
      ].filter((m): m is string => !!m);
  const blocked = !setup || !!setup.missing || !!loadError;

  const startRenew = (m: VisitorMatch) => {
    setRenewing(m);
    setFailure(null);
    if (m.kind) pickKind(m.kind);
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
    if (r.success) setDone({ ...r.data, renewed: !!renewing });
    else setFailure(r.error);
  };

  const another = () => {
    setDone(null);
    setRenewing(null);
    setName("");
    setCompany("");
    setHostText("");
    setHost(null);
    pickKind("DAY_PASS");
    getNewVisitorData({ siteId: site.id }).then((r) => r.success && setSetup(r.data));
  };

  const shownName = done?.name ?? renewing?.name ?? name.trim();
  const title = done ? (done.renewed ? "Pass renewed" : "Visitor added") : renewing ? `Renew ${renewing.name}` : shownName || "New visitor";
  const subtitle = done ? `${done.siteName} · badge ${done.badge}` : `${site.name} · the badge works here only`;

  let hint: ReactNode = null;
  if (done) hint = null;
  else if (setup?.missing) hint = null;
  else if (missing.length) hint = `Still needed: ${missing.join(", ")}.`;
  else if (setup)
    hint = (
      <>
        <CircleCheck aria-hidden="true" />
        {renewing ? `Ready to renew through ${dayWords(lastDay)}.` : "Ready to add."}
      </>
    );

  return (
    <Overlay className={`${frame.scrim} ta-sheet-scrim`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={windowRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="new-visitor-title" className={`${frame.window} ta-sheet`}>
        <header className={frame.head}>
          <span className={frame.glyph} aria-hidden="true">
            {done ? <BadgeCheck /> : renewing ? <RefreshCw /> : <UserPlus />}
          </span>
          <span className={frame.titles}>
            <h2 id="new-visitor-title" className={`${frame.title} truncate`}>
              {title}
            </h2>
            <span className={`${frame.subtitle} truncate`}>{subtitle}</span>
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className={`${frame.body} ${styles.stack}`}>
          {loadError && <Banner tone="error" title="Visitors could not be opened" body={loadError} />}
          {setup?.missing && (
            <Banner tone="warning" title="This company is not set up for visitors" body={`Visitors need ${setup.missing}. Ask a System Admin to add it, then try again.`} />
          )}

          {done ? (
            <section className={`${frame.card} ${styles.doneCard}`} aria-live="polite">
              <BadgePreview
                name={done.name}
                company={renewing?.company ?? company.trim()}
                badge={done.badge}
                kind={done.kind}
                lastDay={done.validUntil}
                siteName={done.siteName}
              />
              <p className={styles.doneText}>
                {done.renewed ? "The badge works again" : "The badge works"} at {done.siteName} through {dayWords(done.validUntil)}.
              </p>
            </section>
          ) : (
            <div className={frame.panes}>
              {/* ── The visitor ── */}
              <section className={frame.card} aria-labelledby="nv-visitor">
                <h3 id="nv-visitor" className={styles.cardLabel}>
                  Visitor
                </h3>
                {failure && <Banner tone="error" title={renewing ? "The pass was not renewed" : "The visitor was not added"} body={failure} />}

                {renewing ? (
                  <div className={styles.renewing}>
                    <div className={styles.renewRow}>
                      <span className={styles.renewName}>{renewing.name}</span>
                      <span className={styles.renewMeta}>
                        {[renewing.company, renewing.badge].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <p className={styles.note}>
                      {renewing.siteId && renewing.siteId !== site.id
                        ? `Their badge works at ${renewing.siteName ?? "another building"} today. Renewing moves it here.`
                        : "Same person, same badge. Only the pass changes."}
                    </p>
                    <Button hierarchy="tertiary" size="sm" onClick={() => setRenewing(null)}>
                      Add someone new instead
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={100} required />
                    {matches.length > 0 && (
                      <div className={styles.matches} role="group" aria-label="Visitors with this name">
                        <span className={frame.groupLabel}>Has this person been here before?</span>
                        {matches.map((m) => {
                          const s = standingWords(m);
                          return (
                            <div key={m.id} className={styles.match}>
                              <span className={styles.matchText}>
                                <span className={styles.matchName}>{m.name}</span>
                                <span className={styles.matchMeta}>
                                  {[m.company, m.badge, m.siteName].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                              <span className={styles.pill} data-tone={s.tone}>
                                {s.text}
                              </span>
                              <Button hierarchy="secondary" size="sm" onClick={() => startRenew(m)}>
                                Renew
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <Input
                      label="Company"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      list="nv-companies"
                      autoComplete="off"
                      maxLength={100}
                      required
                    />
                    <datalist id="nv-companies">
                      {setup?.companies.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    <div className={styles.hostField}>
                      <Input
                        label="Visiting"
                        hint={host ? `${host.department ?? "Staff"}${host.here ? "" : " · another building"}` : "Pick someone from the list, or type a name."}
                        value={host ? host.name : hostText}
                        onChange={(e) => {
                          setHost(null);
                          setHostText(e.target.value);
                        }}
                        onFocus={() => setHostFocus(true)}
                        onBlur={() => setTimeout(() => setHostFocus(false), 150)}
                        autoComplete="off"
                        maxLength={100}
                        required
                      />
                      {hostFocus && !host && hosts.length > 0 && (
                        <div className={styles.suggest} role="listbox" aria-label="Staff">
                          {hosts.map((h) => (
                            <button
                              key={h.id}
                              type="button"
                              role="option"
                              aria-selected={false}
                              className={styles.suggestRow}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setHost(h);
                                setHostText(h.name);
                                setHostFocus(false);
                              }}
                            >
                              <span className={styles.suggestName}>{h.name}</span>
                              <span className={styles.suggestMeta}>{[h.department, h.here ? null : "Another building"].filter(Boolean).join(" · ")}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>

              {/* ── The pass ── */}
              <aside className={frame.rail} aria-label="Pass">
                <div className={frame.railBlock}>
                  <div role="radiogroup" aria-label="Kind of visitor" className={frame.choices}>
                    {(["DAY_PASS", "FREQUENT"] as VisitorKind[]).map((k) => {
                      const Icon = KIND_ICON[k];
                      const on = kind === k;
                      return (
                        <label key={k} className={frame.choice} data-on={on}>
                          <input type="radio" name="nv-kind" value={k} checked={on} onChange={() => pickKind(k)} className="sr-only" />
                          <span className={frame.choiceIcon} aria-hidden="true">
                            <Icon />
                          </span>
                          <span className={frame.choiceText}>
                            <span className={frame.choiceTitle}>{VISITOR_KIND_LABEL[k]}</span>
                            <span className={frame.choiceBody}>{KIND_BODY[k]}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <SegmentedControl
                    ariaLabel="How long"
                    fullWidth
                    items={VISITOR_TERMS[kind].map((t) => ({ value: t, label: VISITOR_TERM_LABEL[t] }))}
                    value={term}
                    onChange={(v) => setTerm(v as VisitorTerm)}
                  />
                </div>
                <div className={`${frame.railBlock} ${frame.previewBlock}`}>
                  <BadgePreview
                    name={shownName || "Visitor name"}
                    company={(renewing ? renewing.company : company.trim()) || null}
                    badge={renewing?.badge ?? setup?.nextBadge ?? "CL"}
                    kind={kind}
                    lastDay={renewing ? null : lastDay}
                    siteName={site.name}
                  />
                  <p className={frame.railNote}>
                    {renewing
                      ? `Renewed for ${VISITOR_TERM_LABEL[term]}. Works at ${site.name} only.`
                      : `Works at ${site.name} only, through ${dayWords(lastDay)}.`}
                  </p>
                </div>
              </aside>
            </div>
          )}
        </div>

        <footer className={frame.foot}>
          <span className={`${frame.footHint} ${styles.hint}`} data-ready={!done && !missing.length && !blocked} aria-live="polite">
            {hint}
          </span>
          <span className="ta-sheet-actions contents">
            {done ? (
              <>
                <Button hierarchy="secondary" onClick={another}>
                  Add another visitor
                </Button>
                <Button hierarchy="primary" onClick={onClose}>
                  Done
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
    </Overlay>
  );
}

/**
 * The badge in miniature, as it will print: the Visitor band, who, from
 * where, the number, and when it stops working (large on a day pass, where
 * a guard checks it at a glance).
 */
function BadgePreview({
  name,
  company,
  badge,
  kind,
  lastDay,
  siteName,
}: {
  name: string;
  company: string | null;
  badge: string;
  kind: VisitorKind;
  lastDay: string | null;
  siteName: string;
}) {
  return (
    <div className={styles.badge} data-kind={kind} aria-label="Badge preview">
      <span className={styles.badgeBand}>{VISITOR_KIND_LABEL[kind]}</span>
      <span className={styles.badgeBody}>
        <span className={styles.badgeName}>{name}</span>
        {company && <span className={styles.badgeCompany}>{company}</span>}
        <span className={styles.badgeNumber}>{badge}</span>
      </span>
      <span className={styles.badgeFoot}>
        <span className={styles.badgeSite}>{siteName}</span>
        {lastDay && (
          <span className={styles.badgeUntil}>
            <span className={styles.badgeUntilLabel}>Valid through</span>
            <span className={styles.badgeUntilDate}>{dayWords(lastDay)}</span>
          </span>
        )}
      </span>
    </div>
  );
}
