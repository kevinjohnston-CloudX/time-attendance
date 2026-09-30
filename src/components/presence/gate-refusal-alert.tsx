"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarPlus, ShieldAlert } from "lucide-react";
import { Badge, Button, ConfirmDialog } from "@/components/ui";
import { dismissOnSiteGateRefusals, getOnSiteGateRefusals } from "@/actions/gate-refusals.actions";
import type { GateRefusalCard } from "@/lib/presence/gate-refusals.service";
import { formatTimeOfDay } from "@/lib/utils/date";
import { Face } from "./face";
import { fmtTime, initialsOf } from "./presence-meta";
import { ScheduleDayDialog } from "./schedule-day-dialog";
import styles from "./on-site.module.css";

/**
 * The gate alert: somebody the gate just turned away for having no shift
 * today, for loss prevention to settle while they are still at the door.
 *
 * <p>One card at a time, oldest first, so the card being read stays put while
 * others arrive; the band says how many more are waiting. Dismiss hides that
 * person's alert for the rest of the day, however many more times they try.
 * Add to schedule opens the usual form filled in with the shift on their
 * record, and saving it lets them in on their next try. Neither can be skipped
 * with Escape or a click outside, because an alert nobody answered is exactly
 * the one that matters.
 *
 * <p>Asks every 15 seconds while the tab is visible, and at once when it comes
 * back, since somebody is standing at the gate. A failed check says nothing
 * and the next one tries again: this sits over the page, and an error box
 * appearing on its own would be louder than the thing it failed to show.
 *
 * <p>Drawn at the top of the page rather than inside the board, so nothing in
 * the header or the full screen board can end up on top of it.
 */

const POLL_MS = 15_000;

export function GateRefusalAlert({
  siteId,
  tz,
  live,
  onScheduled,
}: {
  siteId: string;
  /** The building's timezone, for the times on the card. */
  tz: string;
  /** Whether the gates decide from CloudTime's schedule, so adding opens the door. */
  live: boolean;
  onScheduled: (name: string) => void;
}) {
  const [queue, setQueue] = useState<{ siteId: string; cards: GateRefusalCard[]; total: number } | null>(null);
  // Settled here and hidden at once, before the next check agrees.
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await getOnSiteGateRefusals({ siteId });
        if (!dead && r.success) setQueue({ siteId, cards: r.data.cards, total: r.data.total });
      } catch {
        // The next check tries again.
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

  // Another building's alerts never show while this one's are on the way.
  const cards = queue?.siteId === siteId ? queue.cards.filter((c) => !settled.has(c.id)) : [];
  const card = cards[0] ?? null;
  const settledHere = queue?.siteId === siteId ? queue.cards.length - cards.length : 0;
  const open = Math.max(cards.length, (queue?.siteId === siteId ? queue.total : 0) - settledHere);

  // A new card takes focus, so a keyboard lands on it rather than the page behind.
  const cardId = card?.id ?? null;
  useEffect(() => {
    if (cardId && !adding && !confirmingAll) cardRef.current?.focus();
  }, [cardId, adding, confirmingAll]);

  if (!card) return null;

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
        settle(ids);
        setConfirmingAll(false);
      } else {
        setError(
          r.error === "FORBIDDEN"
            ? "You do not have permission to dismiss these alerts."
            : "The alert could not be dismissed. Try again.",
        );
      }
    } catch {
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

  const waiting = open - 1;
  const role = [card.jobTitle, card.department].filter(Boolean).join(" · ");
  // The hours first, since shift names run long; the name sits under them.
  const hours =
    card.usualStart && card.usualEnd ? `${formatTimeOfDay(card.usualStart)} to ${formatTimeOfDay(card.usualEnd)}` : null;
  const tried =
    card.attempts > 1 ? `Tried ${card.attempts} times since ${fmtTime(card.firstAt, tz)}` : `Tried at ${fmtTime(card.lastAt, tz)}`;

  return onTop(
    <div className={styles.gaScrim}>
      <div
        key={card.id}
        ref={cardRef}
        tabIndex={-1}
        className={styles.gaDialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ga-title"
        aria-describedby="ga-reason"
      >
        <div className={styles.gaBand}>
          <span className={styles.gaBandIcon} aria-hidden="true">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <span className={styles.gaBandText}>
            <span id="ga-title" className={styles.gaBandTitle}>
              Entry refused
            </span>
            <span className={styles.gaBandSub} title={card.device ?? undefined}>
              {[card.device ?? "Security gate", tried].join(" · ")}
            </span>
          </span>
          {waiting > 0 && (
            <Badge tone="warning" variant="solid" style={{ flex: "none", whiteSpace: "nowrap" }}>
              {waiting} more waiting
            </Badge>
          )}
        </div>

        <div className={styles.gaBody}>
          <div className={styles.gaWho}>
            <span className={styles.gaPortrait}>
              <span className={styles.initials} style={{ fontSize: 36 }} aria-hidden="true">
                {initialsOf(card.name)}
              </span>
              <Face src={card.photoUrl} personId={card.employeeId} alt={card.name} />
            </span>
            <span className={styles.gaWhoText}>
              <h2 className={styles.gaName} title={card.name}>
                {card.name}
              </h2>
              {role && (
                <span className={styles.gaRole} title={role}>
                  {role}
                </span>
              )}
              <span className={styles.gaCode}>Employee ID {card.employeeCode}</span>
              <span id="ga-reason" className={styles.gaReason}>
                {card.reason === "NOT_A_WORKDAY" ? "Scheduled off today" : "Not on today's schedule"}
              </span>
            </span>
          </div>

          <dl className={styles.gaFacts}>
            <Fact label="Supervisor" value={card.supervisor} empty="None on their record" />
            <Fact label="Usual shift" value={hours ?? card.shift} sub={hours ? card.shift : null} empty="No shift on their record" />
            {card.homeSite && <Fact label="Based at" value={card.homeSite} />}
          </dl>

          <p className={styles.gaHint}>
            {live
              ? "Add them to today's schedule and the gate lets them in on their next try."
              : "Adding to the schedule turns on once the gates check CloudTime's schedule."}
          </p>
          {error && <p className={styles.peError}>{error}</p>}
        </div>

        <div className={styles.gaFoot}>
          <span>
            {cards.length > 1 && (
              <Button hierarchy="tertiary" onClick={() => setConfirmingAll(true)} disabled={busy}>
                Dismiss all {cards.length}
              </Button>
            )}
          </span>
          <span className="flex gap-2">
            <Button hierarchy="secondary" onClick={() => void dismiss([card.id])} disabled={busy}>
              {busy ? "Dismissing…" : "Dismiss"}
            </Button>
            <Button
              leadingIcon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setAdding(true)}
              disabled={busy || !live}
            >
              Add to schedule
            </Button>
          </span>
        </div>
      </div>
    </div>,
  );
}

/** Straight onto the page's body, above every layer the board and header make. */
function onTop(node: ReactNode) {
  return createPortal(node, document.body);
}

function Fact({
  label,
  value,
  sub,
  empty,
}: {
  label: string;
  value: string | null;
  /** A quieter second line, such as the shift's name under its hours. */
  sub?: string | null;
  empty?: string;
}) {
  return (
    <div className={styles.gaFact}>
      <dt>{label}</dt>
      <dd className={value ? undefined : styles.gaFactEmpty}>
        <span className={styles.gaFactValue} title={value ?? undefined}>
          {value || empty}
        </span>
        {sub && (
          <span className={styles.gaFactSub} title={sub}>
            {sub}
          </span>
        )}
      </dd>
    </div>
  );
}
