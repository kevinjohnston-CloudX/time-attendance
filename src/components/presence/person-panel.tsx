"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clock, Coffee, DoorClosed, DoorOpen, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { getOnSitePerson } from "@/actions/presence.actions";
import type { PresenceDetail, PresencePerson, PresenceScan } from "@/lib/presence/types";
import {
  STATUS_META,
  describeScan,
  fmtDuration,
  fmtShift,
  fmtTime,
  fmtWhen,
  initialsOf,
  minutesSince,
  siteDate,
  statusLabel,
} from "./presence-meta";
import styles from "./on-site.module.css";

/**
 * One person, opened from the board: who they are, what they are doing, and
 * every reader that saw them in the last 24 hours.
 *
 * <p>The timeline is fetched when the panel opens and again whenever the board
 * refreshes, rather than being carried in the board itself, because only one
 * person's history is ever wanted at a time and the board is fetched for every
 * viewer every 30 seconds.
 *
 * <p>It sits over the page rather than beside it so the faces keep their full
 * width, and closes on Escape, on the scrim, and on the close button.
 */
export function PersonPanel({
  siteId,
  person,
  tz,
  now,
  refreshedAt,
  onClose,
}: {
  siteId: string;
  person: PresencePerson;
  tz: string;
  now: number;
  refreshedAt: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<PresenceDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  // The board re-renders every few seconds with a fresh onClose, and the focus
  // effect below must run once per opening, not once per render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let live = true;
    getOnSitePerson({ siteId, employeeId: person.id })
      .then((res) => {
        if (!live) return;
        if (res.success) {
          setDetail(res.data);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // Re-read with every board refresh, so a scan that just happened shows up.
  }, [siteId, person.id, refreshedAt]);

  // Focus goes into the panel when it opens and back where it came from when
  // it closes, so a keyboard user is never left on a tile behind the scrim.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    headRef.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  const meta = STATUS_META[person.status];
  const mins = minutesSince(person.since, now);
  const schedule = fmtShift(person.scheduledStart, person.scheduledEnd);

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={person.name}>
        <div ref={headRef} className={styles.panelHead}>
          <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>Employee</span>
          <Button hierarchy="tertiary" size="sm" iconOnly aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className={styles.panelBody}>
          <div className={styles.identity}>
            <span className={styles.portrait}>
              <span className={styles.initials} style={{ fontSize: 36 }} aria-hidden="true">
                {initialsOf(person.name)}
              </span>
              {person.photoUrl && <img src={person.photoUrl} alt={`Photo of ${person.name}`} />}
              <span className={styles.stripe} style={{ background: meta.color, height: 6 }} />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5 pt-1">
              <h2
                className="truncate"
                style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}
                title={person.name}
              >
                {person.name}
              </h2>
              <span className="line-clamp-2" style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                {detail?.jobTitle ?? person.department ?? ""}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={meta.badge} dot>
                  {statusLabel(person)}
                </Badge>
                {person.status === "NO_GATE_SCAN" && <Badge tone="warning">No gate scan</Badge>}
                {person.outsideOnMeal && <Badge tone="neutral">Outside the building</Badge>}
                {person.inactive && <Badge tone="error">Inactive record</Badge>}
              </span>
              <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                {statusSentence(person, tz, mins, new Date(now).toISOString())}
              </span>
            </div>
          </div>

          <div className={styles.facts}>
            <Fact label="Employee code" value={person.employeeCode} />
            <Fact label="Department" value={person.department} />
            <Fact label="Shift" value={detail?.shift ?? person.shift} />
            <Fact label="Scheduled today" value={schedule ?? "Not scheduled"} />
            <Fact label="First in today" value={fmtTime(person.firstInToday, tz) || "Not yet"} />
            <Fact label="Supervisor" value={detail ? detail.supervisor ?? "None assigned" : undefined} />
          </div>

          <section className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <h3 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>Last 24 hours</h3>
              <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>Security gate and time clock</span>
            </div>
            {failed ? (
              <p style={{ margin: "8px 0 0", font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                The scans for this person could not be loaded. They will be tried again on the next refresh.
              </p>
            ) : !detail ? (
              <TimelineSkeleton />
            ) : detail.scans.length === 0 ? (
              <p style={{ margin: "8px 0 0", font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                No reader has seen this person in the last 24 hours.
              </p>
            ) : (
              <Timeline scans={detail.scans} tz={tz} today={siteDate(new Date(now).toISOString(), tz)} />
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

function statusSentence(p: PresencePerson, tz: string, mins: number | null, nowIso: string): string {
  const at = fmtWhen(p.since, tz, nowIso);
  const forHow = mins !== null && mins >= 1 ? ` (${fmtDuration(mins)})` : "";
  switch (p.status) {
    case "WORKING":
      return at ? `On the clock since ${at}${forHow}` : "On the clock";
    case "NO_GATE_SCAN":
      return at ? `Clocked in since ${at}${forHow}, no gate entry` : "On the clock, no gate entry";
    case "ON_MEAL":
      return at ? `Started ${p.breakKind === "BREAK" ? "a break" : "a meal"} at ${at}${forHow}` : statusLabel(p);
    case "OFF_CLOCK":
      return at ? `Inside since ${at}${forHow}, not clocked in` : "Inside, not clocked in";
    case "LEFT":
      return at ? `Left at ${at}` : "Left";
    case "NOT_ARRIVED":
      return p.lateMinutes !== null ? `${fmtDuration(p.lateMinutes)} past the scheduled start` : "Not due yet";
    case "ON_LEAVE":
      return "Approved time off today";
  }
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      {value === undefined ? (
        <span className={styles.skeleton} style={{ width: "60%", height: 14, marginTop: 3 }} />
      ) : (
        <span className={styles.factValue} title={value ?? undefined}>
          {value ?? "None"}
        </span>
      )}
    </div>
  );
}

function Timeline({ scans, tz, today }: { scans: PresenceScan[]; tz: string; today: string }) {
  const items: ReactNode[] = [];
  let day: string | null = null;
  for (const s of scans) {
    const d = siteDate(s.at, tz);
    if (d !== day) {
      day = d;
      items.push(
        <li key={`day-${d}`} className={styles.dayRule}>
          {d === today ? "Today" : "Yesterday"}
        </li>,
      );
    }
    const { icon, kind } = iconFor(s);
    const notes = [
      s.device,
      s.reread ? "Read twice by the reader" : null,
      s.rejected ? "Not accepted by the timecard" : null,
      s.automatic ? "Added by the system" : null,
    ].filter(Boolean);
    items.push(
      <li key={s.id} className={styles.event}>
        <span className={styles.eventTime}>{fmtTime(s.at, tz)}</span>
        <span className={styles.eventIcon} data-kind={kind} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.eventText}>
          <span style={{ font: "var(--weight-medium) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>
            {describeScan(s)}
          </span>
          {notes.length > 0 && (
            <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              {notes.join(". ")}
            </span>
          )}
        </span>
      </li>,
    );
  }
  return <ol className={styles.timeline}>{items}</ol>;
}

function iconFor(s: PresenceScan): { icon: ReactNode; kind: "in" | "out" | "meal" } {
  const cls = "h-3.5 w-3.5";
  if (s.stream === "SECURITY") {
    return s.direction === "IN"
      ? { icon: <DoorOpen className={cls} />, kind: "in" }
      : { icon: <DoorClosed className={cls} />, kind: "out" };
  }
  if (s.punchType === "MEAL_START" || s.punchType === "BREAK_START") return { icon: <Coffee className={cls} />, kind: "meal" };
  if (s.punchType === "MEAL_END" || s.punchType === "BREAK_END") return { icon: <Clock className={cls} />, kind: "in" };
  return { icon: <Clock className={cls} />, kind: s.direction === "IN" ? "in" : "out" };
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-3 pt-3" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="flex items-center gap-3">
          <span className={styles.skeleton} style={{ width: 64, height: 14 }} />
          <span className={styles.skeleton} style={{ width: 28, height: 28, borderRadius: 999 }} />
          <span className={styles.skeleton} style={{ width: "50%", height: 14 }} />
        </span>
      ))}
    </div>
  );
}
