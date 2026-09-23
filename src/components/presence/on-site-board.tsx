"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, SearchX, UserRoundX } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterSelectChip,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  Table,
  TableFooter,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { getOnSiteBoard } from "@/actions/presence.actions";
import type { PresenceBoard, PresencePerson, PresenceStatus } from "@/lib/presence/types";
import {
  AWAY_STATUSES,
  INSIDE_STATUSES,
  STATUS_META,
  comparePeople,
  fmtDuration,
  fmtShift,
  fmtTime,
  fmtWhen,
  initialsOf,
  minutesSince,
  sinceLine,
  siteDate,
  statusLabel,
} from "./presence-meta";
import { PersonPanel } from "./person-panel";
import styles from "./on-site.module.css";

/**
 * The On Site board: who is in one building right now.
 *
 * <p>Laid out as the answer to one question, top to bottom. The headcount
 * says how many people are inside and what they are doing; the counters under
 * it are also the filters, so the number and the way to see those people are
 * the same thing. Below that, faces, grouped by what each person is doing.
 *
 * <p>Refreshes itself every 30 seconds while the tab is visible and stops while
 * it is hidden, so a board left open in a background tab all weekend costs
 * nothing. The filters live in the query string, which is what lets a filtered
 * board survive a reload and be sent to somebody else.
 */

const POLL_MS = 30_000;
/** Past this without a good answer, the board says it is not updating. */
const STALE_MS = 90_000;
const TILES_PER_GROUP = 60;
const ROWS_PER_PAGE = 200;

type StatusFilter = "inside" | PresenceStatus;
type View = "photos" | "list";

const ALL_STATUSES = [...INSIDE_STATUSES, ...AWAY_STATUSES];

function parseStatus(raw: string | null): StatusFilter {
  return raw && (ALL_STATUSES as string[]).includes(raw) ? (raw as PresenceStatus) : "inside";
}

export function OnSiteBoard({
  sites,
  initialSiteId,
  initialBoard,
  initialFilters,
}: {
  sites: { id: string; name: string }[];
  initialSiteId: string | null;
  initialBoard: PresenceBoard | null;
  initialFilters: { status: string | null; dept: string | null; shift: string | null; view: View };
}) {
  const [siteId, setSiteId] = useState(initialSiteId);
  const [board, setBoard] = useState(initialBoard);
  const [status, setStatus] = useState<StatusFilter>(parseStatus(initialFilters.status));
  const [dept, setDept] = useState(initialFilters.dept ?? "");
  const [shift, setShift] = useState(initialFilters.shift ?? "");
  const [view, setView] = useState<View>(initialFilters.view);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  const [rowsShown, setRowsShown] = useState(ROWS_PER_PAGE);

  const [lastOk, setLastOk] = useState(() => (initialBoard ? Date.now() : 0));
  const [failure, setFailure] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [changed, setChanged] = useState<Set<string>>(new Set());

  const inFlight = useRef(false);
  const siteRef = useRef(siteId);
  const previous = useRef(new Map<string, PresenceStatus>());

  // ── Filters in the address bar ──────────────────────────────────────────
  // replaceState rather than a navigation: the rows are already here, and a
  // round trip to the server to narrow them would reset the poll and flash the
  // page. The server still reads the same parameters on a reload.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (siteId) qs.set("site", siteId);
    if (status !== "inside") qs.set("status", status);
    if (dept) qs.set("dept", dept);
    if (shift) qs.set("shift", shift);
    if (view === "list") qs.set("view", "list");
    const next = `${window.location.pathname}?${qs.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [siteId, status, dept, shift, view]);

  // ── Remember who was where, to mark who just moved ──────────────────────
  const absorb = useCallback((next: PresenceBoard, sameSite: boolean) => {
    const moved = new Set<string>();
    const map = new Map<string, PresenceStatus>();
    for (const p of next.people) {
      map.set(p.id, p.status);
      const before = previous.current.get(p.id);
      if (sameSite && before && before !== p.status) moved.add(p.id);
    }
    previous.current = map;
    setBoard(next);
    if (moved.size) setChanged(moved);
  }, []);

  useEffect(() => {
    if (initialBoard) absorb(initialBoard, false);
    // Only the first snapshot; later ones arrive through refresh().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!changed.size) return;
    const t = setTimeout(() => setChanged(new Set()), 2400);
    return () => clearTimeout(t);
  }, [changed]);

  const refresh = useCallback(
    async (forSite: string, opts: { switching?: boolean } = {}) => {
      if (inFlight.current && !opts.switching) return;
      inFlight.current = true;
      try {
        const res = await getOnSiteBoard({ siteId: forSite });
        // A slow answer for a site somebody has already moved away from is
        // dropped, not drawn over the one they are looking at now.
        if (siteRef.current !== forSite) return;
        if (res.success) {
          absorb(res.data, !opts.switching);
          setLastOk(Date.now());
          setFailure(null);
        } else {
          setFailure(res.error === "FORBIDDEN" || res.error === "NOT_FOUND" ? "access" : "error");
        }
      } catch {
        if (siteRef.current === forSite) setFailure("error");
      } finally {
        inFlight.current = false;
        if (siteRef.current === forSite) setSwitching(false);
      }
    },
    [absorb],
  );

  const lastOkRef = useRef(lastOk);
  useEffect(() => {
    lastOkRef.current = lastOk;
  }, [lastOk]);

  // ── The 30 second poll ──────────────────────────────────────────────────
  useEffect(() => {
    if (!siteId) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh(siteId);
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      setHidden(!visible);
      // Coming back to a tab that has been asleep: catch up straight away
      // instead of showing old faces for up to another 30 seconds.
      if (visible && Date.now() - lastOkRef.current > POLL_MS) void refresh(siteId);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [siteId, refresh]);

  // ── The pinned bar ──────────────────────────────────────────────────────
  // The title, the actions and the find row stay on screen while the faces
  // scroll, and shrink to one slim row once the page has moved. Measured the
  // way Leave Requests does it: the distance between the pinned bar and a
  // marker that scrolls away, so it works whichever element is scrolling.
  const barRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const bar = barRef.current;
      const marker = markerRef.current;
      if (!bar || !marker) return;
      const travelled = bar.getBoundingClientRect().top - marker.getBoundingClientRect().top;
      // Two thresholds, so a page sitting right on the line cannot flicker.
      setCondensed((prev) => (prev ? travelled > 4 : travelled > 16));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // The clock the durations and "updated 12 seconds ago" read from.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  function changeSite(next: string) {
    if (!next || next === siteId) return;
    siteRef.current = next;
    setSiteId(next);
    setSelectedId(null);
    setDept("");
    setShift("");
    setExpanded({});
    setSwitching(true);
    setFailure(null);
    previous.current = new Map();
    void refresh(next, { switching: true });
  }

  // ── Derived rows ────────────────────────────────────────────────────────
  const tz = board?.site.timezone ?? "America/New_York";
  const people = useMemo(() => board?.people ?? [], [board]);

  const departments = useMemo(() => distinct(people, "departmentId", "department"), [people]);
  const shifts = useMemo(() => distinct(people, "shiftId", "shift"), [people]);

  // Department and shift narrow the counts as well as the faces: "how many of
  // Receiving are inside" is a question this page is asked. The search does
  // not, because it is for finding one person, not for counting.
  const scoped = useMemo(
    () => people.filter((p) => (!dept || p.departmentId === dept) && (!shift || p.shiftId === shift)),
    [people, dept, shift],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<PresenceStatus, number>;
    for (const p of scoped) c[p.status] += 1;
    return c;
  }, [scoped]);

  const insideTotal = scoped.filter((p) => p.inside).length;
  const outsideOnMeal = scoped.filter((p) => p.outsideOnMeal).length;
  const scheduled = scoped.filter((p) => p.scheduledStart);
  const scheduledArrived = scheduled.filter((p) => p.status !== "NOT_ARRIVED" && p.status !== "ON_LEAVE").length;

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      scoped.filter((p) => {
        if (status === "inside" ? !INSIDE_STATUSES.includes(p.status) : p.status !== status) return false;
        if (!needle) return true;
        return p.name.toLowerCase().includes(needle) || p.employeeCode.toLowerCase().includes(needle);
      }),
    [scoped, status, needle],
  );

  const groups = useMemo(() => {
    const order = status === "inside" ? INSIDE_STATUSES : [status];
    return order
      .map((s) => ({ status: s, people: matches.filter((p) => p.status === s).sort(comparePeople) }))
      .filter((g) => g.people.length > 0);
  }, [matches, status]);

  const selected = selectedId ? people.find((p) => p.id === selectedId) ?? null : null;
  const isFiltered = !!dept || !!shift || !!needle;
  const siteName = board?.site.name ?? sites.find((s) => s.id === siteId)?.name ?? "";

  // ── Live line ───────────────────────────────────────────────────────────
  const age = lastOk ? now - lastOk : Infinity;
  const liveState: "live" | "stale" | "paused" = hidden ? "paused" : age > STALE_MS || failure === "error" ? "stale" : "live";

  function exportCsv() {
    if (!board) return;
    const rows = [...matches].sort(
      (a, b) => ALL_STATUSES.indexOf(a.status) - ALL_STATUSES.indexOf(b.status) || comparePeople(a, b),
    );
    const header = ["Name", "Employee code", "Department", "Shift", "Status", "Since", "First in today", "Scheduled"];
    const lines = [header, ...rows.map((p) => [
      p.name,
      p.employeeCode,
      p.department ?? "",
      p.shift ?? "",
      statusLabel(p),
      fmtTime(p.since, tz),
      fmtTime(p.firstInToday, tz),
      fmtShift(p.scheduledStart, p.scheduledEnd) ?? "",
    ])];
    const csv = lines.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const stamp = `${siteDate(board.generatedAt, tz)} ${fmtTime(board.generatedAt, tz).replace(/[: ]/g, "")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `On Site ${board.site.name} ${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── No site at all ──────────────────────────────────────────────────────
  if (!siteId || sites.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Header siteName="" liveLine={null} actions={null} />
        <Card padding={0}>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No sites to show"
            body="You do not have access to any active site. An administrator can add sites to your access in Roles & Permissions."
          />
        </Card>
      </div>
    );
  }

  const liveLine = (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={styles.live} data-state={liveState} aria-hidden="true" />
      {liveState === "paused" ? (
        <span>Paused while this tab is in the background</span>
      ) : liveState === "stale" ? (
        <>
          <span style={{ color: "var(--text-warning)" }}>
            {lastOk ? `Not updating. Last updated ${fmtTime(new Date(lastOk).toISOString(), tz)}` : "Not updating"}
          </span>
          <Button hierarchy="link" size="sm" onClick={() => void refresh(siteId)}>
            Try again
          </Button>
        </>
      ) : (
        <span>
          Live · updated {age < 10_000 ? "just now" : `${Math.round(age / 1000)} seconds ago`}
        </span>
      )}
    </span>
  );

  const actions = (
    <>
      {sites.length > 1 && (
        <Select aria-label="Site" value={siteId} onChange={(e) => changeSite(e.target.value)} style={{ minWidth: 160 }}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      )}
      <Button hierarchy="secondary" onClick={exportCsv} disabled={!board || matches.length === 0}>
        Export
      </Button>
    </>
  );

  return (
    <div className={`${styles.board} relative flex flex-col gap-4`}>
      <span ref={markerRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-px w-px" />

      <div ref={barRef} className="sticky top-0 z-20 flex flex-col" style={{ background: "var(--surface-page)" }}>
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2"
          style={{ paddingTop: condensed ? 8 : 0, paddingBottom: condensed ? 8 : 12, transition: "padding 140ms ease" }}
        >
          <div className="flex min-w-60 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1
                className="truncate"
                style={{
                  margin: 0,
                  fontSize: condensed ? 20 : 30,
                  lineHeight: condensed ? "26px" : "36px",
                  fontWeight: "var(--weight-bold)",
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                  transition: "font-size 140ms ease, line-height 140ms ease",
                }}
              >
                {siteName ? `On Site at ${siteName}` : "On Site"}
              </h1>
              {/* Slim, the bar keeps the one number this page exists for and
                  whether it is still live, and gives up the sentence. */}
              {condensed && board && (
                <span
                  className="tabular inline-flex items-center gap-2 whitespace-nowrap"
                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                  title={liveState === "live" ? "Live" : liveState === "paused" ? "Paused" : "Not updating"}
                >
                  <span className={styles.live} data-state={liveState} aria-hidden="true" />
                  <span>
                    <strong style={{ color: "var(--text-primary)", fontWeight: "var(--weight-semibold)" }}>
                      {insideTotal.toLocaleString()}
                    </strong>{" "}
                    in the building
                  </span>
                  {status !== "inside" && (
                    <button
                      type="button"
                      className="ta-chip inline-flex items-center gap-1.5 whitespace-nowrap"
                      onClick={() => setStatus("inside")}
                      aria-label={`Showing ${STATUS_META[status].label}. Show everyone inside`}
                      style={{
                        height: 24,
                        padding: "0 8px 0 10px",
                        borderRadius: 999,
                        border: "1px solid var(--stroke-secondary)",
                        background: "var(--surface-card)",
                        font: "var(--type-body2)",
                        fontWeight: "var(--weight-medium)",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                      }}
                    >
                      {STATUS_META[status].label}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </span>
              )}
            </div>
            {!condensed && <div style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>{liveLine}</div>}
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>

        {board && !switching && failure !== "access" && (
              <div className="flex flex-wrap items-center gap-2.5 pb-3">
                <SearchInput
                  placeholder="Name or employee code"
                  value={query}
                  onValueChange={(v) => {
                    setQuery(v);
                    setExpanded({});
                  }}
                />
                {departments.length > 0 && (
                  <FilterSelectChip label="Department" value={dept} options={departments} onChange={setDept} />
                )}
                {shifts.length > 0 && <FilterSelectChip label="Shift" value={shift} options={shifts} onChange={setShift} />}
                {isFiltered && (
                  <Button
                    hierarchy="link"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setDept("");
                      setShift("");
                    }}
                  >
                    Clear all
                  </Button>
                )}
                <span
                  className="tabular ml-auto whitespace-nowrap"
                  style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                >
                  {matches.length.toLocaleString()} {matches.length === 1 ? "person" : "people"}
                </span>
                <SegmentedControl
                  ariaLabel="Layout"
                  size="sm"
                  items={[
                    { value: "photos", label: "Photos" },
                    { value: "list", label: "List" },
                  ]}
                  value={view}
                  onChange={(v) => setView(v as View)}
                />
              </div>
        )}
      </div>

      {failure === "access" ? (
        <Card padding={0}>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="This site is no longer available to you"
            body="Your access may have changed since the page opened. Pick another site, or reload the page."
          />
        </Card>
      ) : switching || !board ? (
        <BoardSkeleton />
      ) : (
        <>
          {/* ── Headcount ─────────────────────────────────────────────── */}
          <section className={styles.headcount} aria-label="Headcount">
            <div className={styles.side}>
              <button
                type="button"
                className={styles.total}
                aria-pressed={status === "inside"}
                onClick={() => setStatus("inside")}
              >
                <span className={styles.totalFigure}>{insideTotal.toLocaleString()}</span>
                <span className={styles.totalLabel}>
                  {insideTotal === 1 ? "person" : "people"} in the building
                </span>
              </button>

              <div className={styles.bar} role="img" aria-label={barLabel(counts, scoped)}>
                {INSIDE_STATUSES.map((s) => {
                  const n = s === "ON_MEAL" ? scoped.filter((p) => p.status === s && p.inside).length : counts[s];
                  return n > 0 ? (
                    <span
                      key={s}
                      className={styles.barPart}
                      style={{
                        flexGrow: n,
                        background: STATUS_META[s].color,
                        opacity: s === "NO_GATE_SCAN" ? 0.55 : 1,
                      }}
                    />
                  ) : null;
                })}
              </div>

              <div className={styles.counters}>
                {INSIDE_STATUSES.filter((s) => s !== "NO_GATE_SCAN" || board.site.hasGateData).map((s) => (
                  <Counter key={s} status={s} count={counts[s]} active={status === s} onClick={() => setStatus(status === s ? "inside" : s)} />
                ))}
              </div>

              <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                {outsideOnMeal > 0 &&
                  `${outsideOnMeal.toLocaleString()} on a meal or break went out through the gate and are not in this count. `}
                {board.site.hasGateData
                  ? `Last security gate scan at ${fmtTime(board.site.lastGateScanAt, tz)}${
                      board.site.lastGateScanAt && siteDate(board.site.lastGateScanAt, tz) !== siteDate(board.generatedAt, tz)
                        ? " yesterday"
                        : ""
                    }`
                  : "The security gate here has not reported in the last 36 hours, so this count comes from the time clock alone."}
              </p>
            </div>

            <div className={styles.side}>
              <span style={{ font: "var(--type-h4)", color: "var(--text-secondary)" }}>Not in the building</span>
              <div className={styles.counters}>
                {AWAY_STATUSES.map((s) => (
                  <Counter key={s} status={s} count={counts[s]} active={status === s} onClick={() => setStatus(status === s ? "inside" : s)} />
                ))}
              </div>
              <p style={{ margin: "auto 0 0", font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                {scheduled.length === 0
                  ? "Nobody here has a schedule for today."
                  : `${scheduledArrived.toLocaleString()} of ${scheduled.length.toLocaleString()} scheduled today have arrived.`}
              </p>
            </div>
          </section>

          {/* ── People ────────────────────────────────────────────────── */}
          {matches.length === 0 ? (
            <Card padding={0}>
              <EmptyBoard status={status} needle={query.trim()} filtered={!!dept || !!shift} siteName={siteName} onClearSearch={() => setQuery("")} />
            </Card>
          ) : view === "list" ? (
            <Card padding={0}>
              <PeopleTable
                people={groups.flatMap((g) => g.people)}
                tz={tz}
                now={now}
                shown={rowsShown}
                onShowMore={() => setRowsShown((n) => n + ROWS_PER_PAGE)}
                onOpen={setSelectedId}
                selectedId={selectedId}
              />
            </Card>
          ) : (
            groups.map((g) => {
              const limit = expanded[g.status] ?? TILES_PER_GROUP;
              const meta = STATUS_META[g.status];
              return (
                <section key={g.status} className={styles.group} aria-label={meta.heading}>
                  <header className={styles.groupHead}>
                    <span className={styles.dot} style={{ background: meta.color }} aria-hidden="true" />
                    <h2 className={styles.groupTitle}>{meta.heading}</h2>
                    <span className={styles.groupCount}>{g.people.length.toLocaleString()}</span>
                    <span className={styles.groupHint}>{meta.hint}</span>
                  </header>
                  <div className={styles.grid}>
                    {g.people.slice(0, limit).map((p) => (
                      <PersonTile
                        key={p.id}
                        person={p}
                        tz={tz}
                        now={now}
                        selected={p.id === selectedId}
                        changed={changed.has(p.id)}
                        onOpen={() => setSelectedId(p.id)}
                      />
                    ))}
                  </div>
                  {g.people.length > limit && (
                    <div className={styles.more}>
                      <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                        Showing {limit.toLocaleString()} of {g.people.length.toLocaleString()}
                      </span>
                      <Button
                        hierarchy="secondary"
                        size="sm"
                        onClick={() => setExpanded((e) => ({ ...e, [g.status]: g.people.length }))}
                      >
                        Show all {g.people.length.toLocaleString()}
                      </Button>
                    </div>
                  )}
                </section>
              );
            })
          )}
        </>
      )}

      {selected && siteId && (
        <PersonPanel
          key={selected.id}
          siteId={siteId}
          person={selected}
          tz={tz}
          now={now}
          refreshedAt={board?.generatedAt ?? ""}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Header({ siteName, liveLine, actions }: { siteName: string; liveLine: React.ReactNode; actions: React.ReactNode }) {
  // The site is part of the title because every number on the page belongs to
  // it, and a count of people "in the building" means nothing without saying
  // which building.
  return (
    <PageHeader
      title={siteName ? `On Site at ${siteName}` : "On Site"}
      subtitle={liveLine ?? undefined}
      actions={actions ?? undefined}
    />
  );
}

function Counter({
  status,
  count,
  active,
  onClick,
}: {
  status: PresenceStatus;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const meta = STATUS_META[status];
  return (
    <button
      type="button"
      className={styles.counter}
      aria-pressed={active}
      data-empty={count === 0 ? "true" : undefined}
      onClick={onClick}
      title={meta.hint}
    >
      <span className={styles.counterFigure}>{count.toLocaleString()}</span>
      <span className={styles.counterLabel}>
        <span
          className={styles.dot}
          style={{ background: meta.color, opacity: status === "NO_GATE_SCAN" ? 0.55 : 1 }}
          aria-hidden="true"
        />
        <span className="truncate">{status === "ON_MEAL" ? "Meal or break" : meta.label}</span>
      </span>
    </button>
  );
}

export function Photo({ person, className, alt = "" }: { person: PresencePerson; className: string; alt?: string }) {
  return (
    <span className={className}>
      <span className={styles.initials} aria-hidden="true">
        {initialsOf(person.name)}
      </span>
      {/* The tablet photo, once the photo store is connected. Until then the
          initials above fill the same frame, so nothing moves when it lands. */}
      {person.photoUrl && <img src={person.photoUrl} alt={alt} loading="lazy" decoding="async" />}
    </span>
  );
}

function PersonTile({
  person: p,
  tz,
  now,
  selected,
  changed,
  onOpen,
}: {
  person: PresencePerson;
  tz: string;
  now: number;
  selected: boolean;
  changed: boolean;
  onOpen: () => void;
}) {
  const meta = STATUS_META[p.status];
  const mins = minutesSince(p.since, now);
  const line =
    p.status === "ON_MEAL" && mins !== null
      ? `${p.breakKind === "BREAK" ? "Break" : "Meal"} for ${fmtDuration(mins)}`
      : sinceLine(p, tz, new Date(now).toISOString());

  return (
    <button
      type="button"
      className={styles.tile}
      aria-pressed={selected}
      data-changed={changed ? "true" : undefined}
      onClick={onOpen}
      title={`${p.name} · ${p.employeeCode}`}
    >
      <span className={styles.photo}>
        <span className={styles.initials} aria-hidden="true">
          {initialsOf(p.name)}
        </span>
        {p.photoUrl && <img src={p.photoUrl} alt="" loading="lazy" decoding="async" />}
        <span
          className={styles.stripe}
          data-dim={p.status === "NO_GATE_SCAN" || p.outsideOnMeal ? "true" : undefined}
          style={{ background: meta.color }}
        />
        <span className={styles.flag}>
          {p.outsideOnMeal && (
            <span className={styles.flagChip} data-tone="neutral">
              Outside
            </span>
          )}
          {p.lateMinutes !== null && (
            <span className={styles.flagChip} data-tone="error">
              {fmtDuration(p.lateMinutes)} late
            </span>
          )}
          {p.inactive && (
            <span className={styles.flagChip} data-tone="error">
              Inactive record
            </span>
          )}
        </span>
      </span>
      <span className={styles.tileBody}>
        <span className={styles.name}>{p.name}</span>
        <span className={styles.meta}>{p.department ?? p.employeeCode}</span>
        <span className={styles.since}>
          <span className={styles.dot} style={{ background: meta.color }} aria-hidden="true" />
          <span>{line}</span>
        </span>
      </span>
    </button>
  );
}

function PeopleTable({
  people,
  tz,
  now,
  shown,
  onShowMore,
  onOpen,
  selectedId,
}: {
  people: PresencePerson[];
  tz: string;
  now: number;
  shown: number;
  onShowMore: () => void;
  onOpen: (id: string) => void;
  selectedId: string | null;
}) {
  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>Employee</TH>
            <TH>Department</TH>
            <TH>Status</TH>
            <TH>Since</TH>
            <TH numeric>For</TH>
            <TH>First In</TH>
            <TH>Scheduled</TH>
          </TR>
        </THead>
        <TBody>
          {people.slice(0, shown).map((p) => {
            const mins = minutesSince(p.since, now);
            return (
              <TR key={p.id} onClick={() => onOpen(p.id)} selected={p.id === selectedId}>
                <TD>
                  <button
                    type="button"
                    className={`${styles.row} flex min-w-0 items-center gap-2.5 border-0 bg-transparent p-0 text-left`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(p.id);
                    }}
                  >
                    <Photo person={p} className={styles.avatar} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate" style={{ fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
                        {p.name}
                      </span>
                      <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                        {p.employeeCode}
                      </span>
                    </span>
                  </button>
                </TD>
                <TD style={{ color: "var(--text-secondary)" }}>
                  <div className="max-w-[200px] truncate">{p.department ?? ""}</div>
                </TD>
                <TD>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Badge tone={STATUS_META[p.status].badge} size="sm" dot>
                      {statusLabel(p)}
                    </Badge>
                    {p.lateMinutes !== null && (
                      <span style={{ font: "var(--type-body2)", color: "var(--text-error)", whiteSpace: "nowrap" }}>
                        {fmtDuration(p.lateMinutes)} late
                      </span>
                    )}
                    {p.inactive && (
                      <Badge tone="error" size="sm">
                        Inactive record
                      </Badge>
                    )}
                  </span>
                </TD>
                <TD className="tabular" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  {fmtWhen(p.since, tz, new Date(now).toISOString())}
                </TD>
                <TD numeric style={{ whiteSpace: "nowrap" }}>
                  {mins !== null && p.status !== "LEFT" ? fmtDuration(mins) : ""}
                </TD>
                <TD className="tabular" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  {fmtTime(p.firstInToday, tz)}
                </TD>
                <TD style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  {fmtShift(p.scheduledStart, p.scheduledEnd) ?? ""}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <TableFooter
        shown={Math.min(shown, people.length)}
        total={people.length}
        label={people.length === 1 ? "person" : "people"}
      />
      {people.length > shown && (
        <div className="flex justify-center px-4 pb-4">
          <Button hierarchy="secondary" size="sm" onClick={onShowMore}>
            Show {Math.min(ROWS_PER_PAGE, people.length - shown).toLocaleString()} more
          </Button>
        </div>
      )}
    </>
  );
}

function EmptyBoard({
  status,
  needle,
  filtered,
  siteName,
  onClearSearch,
}: {
  status: StatusFilter;
  needle: string;
  filtered: boolean;
  siteName: string;
  onClearSearch: () => void;
}) {
  if (needle) {
    return (
      <EmptyState
        icon={<SearchX className="h-8 w-8" />}
        title="No matching people"
        body={`Nobody here matches "${needle}". The search only looks at the group you have open; try another group or clear the search.`}
        action={
          <Button hierarchy="secondary" size="sm" onClick={onClearSearch}>
            Clear search
          </Button>
        }
      />
    );
  }
  const empty: Record<StatusFilter, [string, string]> = {
    inside: ["Nobody is in the building", `No one at ${siteName} is through the gate or on the clock right now.`],
    WORKING: ["Nobody is working", "No one is on the clock and through the gate right now."],
    NO_GATE_SCAN: ["Everyone on the clock came through the gate", "Nobody is clocked in without a security gate scan."],
    ON_MEAL: ["Nobody is on a meal or break", "Everyone on the clock is working."],
    OFF_CLOCK: ["Nobody is inside off the clock", "Everyone who came through the gate is on the clock or has left."],
    NOT_ARRIVED: ["Everyone scheduled has arrived", "No one scheduled for today is still missing."],
    LEFT: ["Nobody has left yet", "No one who was here today has gone home."],
    ON_LEAVE: ["Nobody is on leave today", "No approved time off covers today."],
  };
  const [title, body] = empty[status];
  return (
    <EmptyState
      icon={<UserRoundX className="h-8 w-8" />}
      title={title}
      body={filtered ? `${body} This only counts the department and shift you have filtered to.` : body}
    />
  );
}

function BoardSkeleton() {
  const bar = (w: string | number, h: number) => (
    <span className={styles.skeleton} style={{ width: w, height: h }} />
  );
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading who is on site">
      <div className={styles.headcount}>
        <div className={styles.side}>
          {bar(220, 44)}
          {bar("100%", 10)}
          <div className={styles.counters}>
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i}>{bar("100%", 58)}</span>
            ))}
          </div>
        </div>
        <div className={styles.side}>
          {bar(160, 20)}
          <div className={styles.counters}>
            {Array.from({ length: 3 }, (_, i) => (
              <span key={i}>{bar("100%", 58)}</span>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.group}>
        <div className={styles.groupHead}>{bar(180, 18)}</div>
        <div className={styles.grid}>
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="flex flex-col gap-2">
              {bar("100%", 150)}
              {bar("70%", 12)}
              {bar("50%", 10)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Filter options from the people on the board, under their own names. Only
 * departments and shifts somebody is actually in are offered, so no choice in
 * the list can only ever come back empty.
 */
function distinct(
  people: PresencePerson[],
  idKey: "departmentId" | "shiftId",
  nameKey: "department" | "shift",
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of people) {
    const id = p[idKey];
    const name = p[nameKey];
    if (id && name && !seen.has(id)) seen.set(id, name);
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function barLabel(counts: Record<PresenceStatus, number>, scoped: PresencePerson[]): string {
  const outsideMeal = scoped.filter((p) => p.status === "ON_MEAL" && !p.inside).length;
  return INSIDE_STATUSES.map((s) => {
    const n = s === "ON_MEAL" ? counts[s] - outsideMeal : counts[s];
    return `${n} ${STATUS_META[s].label.toLowerCase()}`;
  }).join(", ");
}

function csvCell(v: string): string {
  const s = String(v ?? "");
  // A leading = + - or @ is read as a formula by spreadsheet programs.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
