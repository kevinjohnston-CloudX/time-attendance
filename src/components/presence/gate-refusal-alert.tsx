"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CalendarPlus } from "lucide-react";
import { Button, ConfirmDialog } from "@/components/ui";
import { dismissOnSiteGateRefusals, getOnSiteGateRefusals } from "@/actions/gate-refusals.actions";
import type { GateRefusalCard } from "@/lib/presence/gate-refusals.service";
import { formatTimeOfDay } from "@/lib/utils/date";
import { gateLog } from "@/lib/presence/gate-alert-log";
import { Face } from "./face";
import { fmtTime, initialsOf } from "./presence-meta";
import { ScheduleDayDialog } from "./schedule-day-dialog";
import { useOnPulseChange } from "./use-site-pulse";
import { newWatchId, noteAlertCheck, screenId, sendWatch } from "./screen-watch";
import styles from "./on-site.module.css";

/**
 * The gate alert: somebody the gate just turned away for having no shift
 * today, for loss prevention to settle while they are still at the door.
 *
 * <p>One card at a time, oldest first, so the card being read stays put while
 * others arrive; the top line says how many are waiting. Dismiss hides that
 * person's alert for the rest of the day, however many more times they try.
 * Add to schedule opens the usual form filled in with the shift on their
 * record, and saving it lets them in on their next try. Neither can be skipped
 * with Escape or a click outside. A card nobody touches for 45 seconds steps
 * aside on its own, on this screen only, and comes back if they try again.
 *
 * <p>Drawn from the page's own pieces: a photo with the status band across
 * its foot like the tiles, the soft amber chip the rows use for a warning,
 * and the employee panel's day at a glance strip. Built to be noticed from
 * across the room: an amber header, a pulsing icon and a slow amber glow
 * around the card for as long as it waits.
 *
 * <p>Loads the moment the page's 2 second check sees today's refusals here
 * change (a new try, or a dismissal on another screen), every 15 seconds
 * besides while the tab is visible, and at once when it comes back, since
 * somebody is standing at the gate. A failed check says nothing
 * and the next one tries again: this sits over the page, and an error box
 * appearing on its own would be louder than the thing it failed to show.
 *
 * <p>Shows nothing while a System Admin has gate alerts off in this building (the switch in
 * the page header): the server answers an empty list, and a card already on
 * screen goes at the next check.
 *
 * <p>Drawn at the top of the page rather than inside the board, so nothing in
 * the header or the full screen board can end up on top of it.
 *
 * <p>Says what it does in the browser console under "[gate-alert]": each card
 * it shows, each one that closes on its own, and any check or dismissal that
 * fails, once per run of failures rather than every 15 seconds.
 */

const POLL_MS = 15_000;
/** How long a card waits for somebody before it steps aside. */
const IDLE_MS = 45_000;
/** The card's two answers, drawn larger than the page's buttons. */
const BIG = { height: 56, padding: "0 24px", gap: 10, borderRadius: 14, font: "var(--weight-semibold) 17px/24px var(--font-sans)" };

export function GateRefusalAlert({
  siteId,
  tz,
  live,
  pulse,
  onScheduled,
}: {
  siteId: string;
  /** The building's timezone, for the times on the card. */
  tz: string;
  /** Whether the gates decide from CloudTime's schedule, so adding opens the door. */
  live: boolean;
  /** When today's refusals here last changed (see use-site-pulse.ts): a change loads them straight away. */
  pulse?: string | null;
  onScheduled: (name: string) => void;
}) {
  const [queue, setQueue] = useState<{ siteId: string; cards: GateRefusalCard[]; total: number } | null>(null);
  // Settled here and hidden at once, before the next check agrees.
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  // Cards nobody answered, by the try they were showing. A new try shows them again.
  const [timedOut, setTimedOut] = useState<ReadonlyMap<string, string>>(new Map());
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The idle clock, keyed by the card and try it is counting for, so the next
  // card never inherits one that has already run out.
  const [clock, setClock] = useState<{ key: string; until: number } | null>(null);
  const [now, setNow] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const bumpedAt = useRef(0);
  const failing = useRef<string | null>(null);
  // The card on screen as the diagnostics know it, and why cards went away,
  // so each appearance is reported with how it ended (see screen-watch.ts).
  const view = useRef<{ id: string; refusalId: string; siteId: string } | null>(null);
  const closing = useRef(new Map<string, string>());

  useEffect(() => {
    let dead = false;
    const load = async () => {
      if (document.hidden) return;
      // A failure is said once, and again only after a check has worked.
      const failed = (error: string) => {
        if (failing.current !== error) gateLog("failed", { at: "check for alerts", site: siteId, error }, "warn");
        failing.current = error;
        noteAlertCheck(null, error);
      };
      try {
        const r = await getOnSiteGateRefusals({ siteId });
        if (dead) return;
        if (r.success) {
          failing.current = null;
          noteAlertCheck(r.data.cards.length);
          setQueue({ siteId, cards: r.data.cards, total: r.data.total });
        } else failed(r.error);
      } catch {
        // Offline or the server is restarting: the next check tries again.
        if (!dead) failed("UNREACHABLE");
      }
    };
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dead = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [siteId, reload]);

  useOnPulseChange(pulse, true, () => setReload((n) => n + 1));

  // Another building's alerts never show while this one's are on the way.
  const mine = queue?.siteId === siteId ? queue : null;
  const cards = mine ? mine.cards.filter((c) => !settled.has(c.id) && timedOut.get(c.id) !== c.lastAt) : [];
  const card = cards[0] ?? null;
  const open = mine ? Math.max(cards.length, mine.total - (mine.cards.length - cards.length)) : 0;
  const cardId = card?.id ?? null;
  const clockKey = card ? `${card.id}|${card.lastAt}` : null;
  const paused = adding || confirmingAll || busy;

  // A new card takes focus, so a keyboard lands on it rather than the page behind.
  useEffect(() => {
    if (cardId && !adding && !confirmingAll) cardRef.current?.focus();
  }, [cardId, adding, confirmingAll]);

  useEffect(() => {
    if (clockKey) gateLog("showing", { refusal: clockKey.split("|")[0], lastTry: clockKey.split("|")[1], waiting: open });
    // Reported to the server too: the last card ends, with how, and this one starts.
    const prev = view.current;
    if (prev) {
      const how =
        closing.current.get(prev.refusalId) ??
        (prev.siteId !== siteId ? "LEFT" : card?.id === prev.refusalId ? "NEWER_TRY" : "GONE");
      closing.current.delete(prev.refusalId);
      sendWatch([{ kind: "closed", viewId: prev.id, how }]);
      view.current = null;
    }
    if (card) {
      const id = newWatchId();
      view.current = { id, refusalId: card.id, siteId };
      sendWatch([
        {
          kind: "shown",
          viewId: id,
          screenId,
          siteId,
          refusalId: card.id,
          refusalLastAt: card.lastAt,
          attempts: card.attempts,
          visible: document.visibilityState === "visible",
        },
      ]);
    }
    // Once per card and try, not on every change to the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockKey]);

  // Leaving the page with a card up ends it there.
  useEffect(() => {
    const leave = () => {
      const v = view.current;
      if (!v) return;
      sendWatch([{ kind: "closed", viewId: v.id, how: "LEFT" }], true);
      view.current = null;
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  // The idle clock: a full 45 seconds for each card, and again after anybody
  // touches it, comes back from the form, or returns to the tab.
  useEffect(() => {
    if (!clockKey || paused) return;
    const start = Date.now();
    setNow(start);
    setClock({ key: clockKey, until: start + IDLE_MS });
    const t = setInterval(() => {
      const at = Date.now();
      if (document.hidden) setClock({ key: clockKey, until: at + IDLE_MS });
      setNow(at);
    }, 1000);
    return () => clearInterval(t);
  }, [clockKey, paused]);

  // Nobody answered: it steps aside on this screen. Not a dismissal, so the
  // next try at the gate brings it straight back.
  const running = clock && clock.key === clockKey ? clock : null;
  useEffect(() => {
    if (card && !paused && running && now >= running.until) {
      gateLog("closed on its own", { refusal: card.id, after: `${IDLE_MS / 1000}s` });
      closing.current.set(card.id, "AUTO");
      setTimedOut((m) => new Map(m).set(card.id, card.lastAt));
    }
  }, [card, paused, running, now]);

  if (!card) return null;

  function bump() {
    const at = Date.now();
    if (!clockKey || at - bumpedAt.current < 1000) return;
    bumpedAt.current = at;
    setClock({ key: clockKey, until: at + IDLE_MS });
  }

  function settle(ids: string[]) {
    setSettled((s) => new Set([...s, ...ids]));
    setError(null);
    setReload((n) => n + 1);
  }

  async function dismiss(ids: string[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await dismissOnSiteGateRefusals({ siteId, refusalIds: ids });
      // NOT_FOUND is somebody else having settled it first: gone either way.
      if (r.success || r.error === "NOT_FOUND") {
        for (const id of ids) closing.current.set(id, r.success ? "DISMISSED" : "GONE");
        settle(ids);
        setConfirmingAll(false);
      } else {
        gateLog("failed", { at: "dismiss", site: siteId, error: r.error }, "warn");
        setError(
          r.error === "FORBIDDEN"
            ? "You do not have permission to dismiss these alerts."
            : "The alert could not be dismissed. Try again.",
        );
      }
    } catch {
      gateLog("failed", { at: "dismiss", site: siteId, error: "UNREACHABLE" }, "warn");
      setError("The alert could not be dismissed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (adding) {
    return onTop(
      <ScheduleDayDialog
        siteId={siteId}
        employeeId={card.employeeId}
        name={card.name}
        dayLabel="Today"
        initial={{ startTime: card.usualStart, endTime: card.usualEnd }}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          closing.current.set(card.id, "ADDED");
          settle([card.id]);
          onScheduled(card.name);
        }}
      />,
    );
  }

  if (confirmingAll) {
    return onTop(
      <ConfirmDialog
        title={`Dismiss ${cards.length} alerts?`}
        confirmLabel={`Dismiss ${cards.length} alerts`}
        pendingLabel="Dismissing…"
        tone="warning"
        pending={busy}
        error={error}
        onConfirm={() => void dismiss(cards.map((c) => c.id))}
        onCancel={() => {
          setConfirmingAll(false);
          setError(null);
        }}
      >
        None of these people will show here again today, however many times they try the gate. They can still be
        added to the schedule from their details on Live Attendance.
      </ConfirmDialog>,
    );
  }

  const role = [card.jobTitle, card.department].filter(Boolean).join(" · ");
  // The hours first, since shift names run long; the name sits under them.
  const hours =
    card.usualStart && card.usualEnd ? `${formatTimeOfDay(card.usualStart)} to ${formatTimeOfDay(card.usualEnd)}` : null;
  const firstTry = card.attempts > 1 ? `First at ${fmtTime(card.firstAt, tz)}` : `At ${fmtTime(card.lastAt, tz)}`;
  const left = running ? Math.max(0, Math.ceil((running.until - now) / 1000)) : IDLE_MS / 1000;

  return onTop(
    <div className={styles.gaScrim}>
      <div
        key={card.id}
        ref={cardRef}
        tabIndex={-1}
        className={styles.gaCard}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ga-title ga-name"
        aria-describedby="ga-reason"
        onPointerMove={bump}
        onPointerDown={bump}
        onKeyDown={bump}
      >
        <div className={styles.gaHead}>
          <span className={styles.gaHeadIcon} aria-hidden="true">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <span className={styles.gaHeadText}>
            <span id="ga-title" className={styles.gaHeadTitle}>
              Entry refused
            </span>
            <span className={styles.gaHeadSub} title={card.device ?? undefined}>
              {card.device ?? "Security gate"} · {fmtTime(card.lastAt, tz)}
            </span>
          </span>
          {open > 1 && (
            <span className={styles.gaQueue}>
              <span className={styles.gaQueueCount}>1 of {open}</span>
              {cards.length > 1 && (
                <Button hierarchy="link" size="sm" onClick={() => setConfirmingAll(true)} disabled={busy}>
                  Dismiss all
                </Button>
              )}
            </span>
          )}
        </div>

        <div className={styles.gaBody}>
        <div className={styles.gaHero}>
          <span className={styles.gaPhoto}>
            <span className={styles.initials} style={{ fontSize: 56 }} aria-hidden="true">
              {initialsOf(card.name)}
            </span>
            <Face src={card.photoUrl} personId={card.employeeId} alt={card.name} />
            <span className={styles.gaStripe} aria-hidden="true" />
          </span>
          <span className={styles.gaWho}>
            <h2 id="ga-name" className={styles.gaName} title={card.name}>
              {card.name}
            </h2>
            {role && (
              <span className={styles.gaRole} title={role}>
                {role}
              </span>
            )}
            <span className={styles.gaMeta}>
              Employee ID {card.employeeCode}
              {card.homeSite ? ` · Based at ${card.homeSite}` : ""}
            </span>
            <span id="ga-reason" className={styles.gaStatus}>
              <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
              {card.reason === "NOT_A_WORKDAY" ? "Scheduled off today" : "Not on today's schedule"}
            </span>
          </span>
        </div>

        <div className={styles.gaGlance}>
          <Cell label="Supervisor" value={card.supervisor} empty="None on record" />
          <Cell label="Usual shift" value={hours ?? card.shift} sub={hours ? card.shift : null} empty="No shift on record" />
          <Cell label="Tries today" value={String(card.attempts)} sub={firstTry} />
        </div>

        {!live && <p className={styles.gaNote}>Adding to the schedule turns on once the gates check CloudTime&apos;s schedule.</p>}
        {error && <p className={styles.peError}>{error}</p>}

        <div className={styles.gaActions}>
          <Button hierarchy="secondary" fullWidth style={BIG} onClick={() => void dismiss([card.id])} disabled={busy}>
            {busy ? "Dismissing…" : "Dismiss"}
          </Button>
          <Button
            fullWidth
            style={BIG}
            leadingIcon={<CalendarPlus className="h-5 w-5" aria-hidden="true" />}
            onClick={() => setAdding(true)}
            disabled={busy || !live}
          >
            Add to schedule
          </Button>
        </div>
        <p className={styles.gaCountdown}>
          Closes on its own in <span className="tabular">{left}</span> {left === 1 ? "second" : "seconds"}
        </p>
        </div>
        <span className={styles.gaTimer} aria-hidden="true">
          <span style={{ width: `${(left / (IDLE_MS / 1000)) * 100}%` }} />
        </span>
      </div>
    </div>,
  );
}

/**
 * Straight onto the page's body, above every layer the board and header make,
 * inside the board's class so the page's status colours still apply.
 */
function onTop(node: ReactNode) {
  return createPortal(<div className={styles.board}>{node}</div>, document.body);
}

/** One cell of the strip, drawn like the employee panel's day at a glance. */
function Cell({ label, value, sub, empty = "" }: { label: string; value: string | null; sub?: string | null; empty?: string }) {
  return (
    <div className={styles.gaCell}>
      <span className={styles.ppGlanceLabel}>{label}</span>
      <span className={styles.gaCellValue} data-empty={value ? undefined : "true"} title={value ?? undefined}>
        {value || empty}
      </span>
      <span className={styles.ppGlanceSub} title={sub ?? undefined}>
        {sub}
      </span>
    </div>
  );
}
