"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarPlus, Camera, ChevronLeft, ChevronRight, Clock, Coffee, DoorClosed, DoorOpen, UserCircle, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { getOnSitePerson } from "@/actions/presence.actions";
import { addDays, dayLabel, DAYS_BACK } from "@/lib/presence/days";
import { buildLanes, leftBuilding, type DayLanes } from "@/lib/presence/lanes";
import { LATE_GRACE_MIN } from "@/lib/presence/movements";
import { isShownScan } from "@/lib/presence/scan-rules";
import type { PresenceDetail, PresencePerson, PresenceScan } from "@/lib/presence/types";
import { formatTimeOfDay, snapToLocalTime } from "@/lib/utils/date";
import {
  STATUS_META,
  describeOriginal,
  describeScan,
  fmtDuration,
  fmtShift,
  fmtTime,
  fmtWhen,
  initialsOf,
  minutesSince,
  statusLabel,
} from "./presence-meta";
import styles from "./on-site.module.css";
import { usePhoto, ZoomableFace } from "./face";
import { PhotoEditor } from "./photo-editor";
import { ScheduleDayDialog } from "./schedule-day-dialog";
import { HomeSiteBadge } from "./home-site";

/**
 * One person, opened from the board or the scan log: who they are, and their
 * day at both readers, drawn as two lanes on one clock so the gaps between
 * them show.
 *
 * <p>The day is fetched when the panel opens, again whenever the board
 * refreshes while it shows today, and again when somebody steps to another
 * day. Only one person's day is ever wanted at a time, so it is not carried
 * in the board, which every viewer fetches every 30 seconds.
 *
 * <p>It sits over the page rather than beside it so the faces keep their full
 * width, and closes on Escape, on the scrim, and on the close button.
 */

/** A gap this long between the readers is worth a second look. */
const GAP_WORTH_NOTING_MIN = 15;

export function PersonPanel({
  siteId,
  employeeId,
  person,
  initialDay,
  today,
  hasGateData,
  tz,
  now,
  refreshedAt,
  onClose,
  onZoom,
  canEditPhoto = false,
  onPhotoSaved,
  scheduling = null,
  onScheduled,
  canViewProfile = false,
}: {
  siteId: string;
  employeeId: string;
  /** Their place on the board right now, when they have one. */
  person: PresencePerson | null;
  /** The day to open on; null for today. */
  initialDay: string | null;
  today: string;
  hasGateData: boolean;
  tz: string;
  now: number;
  refreshedAt: string;
  onClose: () => void;
  /** Opens the photo large; the panel stays open behind it. */
  onZoom?: (src: string, who: { name: string; detail: string }) => void;
  /**
   * Whether the viewer may replace this person's photo. Only decides whether
   * the button is drawn; the save checks the permission again on the server.
   */
  canEditPhoto?: boolean;
  onPhotoSaved?: (employeeId: string, photoUrl: string | null) => void;
  /**
   * Whether the viewer may add somebody to today's schedule, and whether that
   * is switched on yet. Null draws nothing; the save checks both again on the
   * server.
   */
  scheduling?: { live: boolean } | null;
  onScheduled?: () => void;
  /**
   * Whether to link to the person's employee profile. The profile page
   * checks the same permission itself; this only avoids a link that would
   * send someone without it straight back out.
   */
  canViewProfile?: boolean;
}) {
  const [day, setDay] = useState(initialDay ?? today);
  const [editingPhoto, setEditingPhoto] = useState(false);
  const [addingShift, setAddingShift] = useState(false);
  // Bumped after a save, so the day is read again with its new shift.
  const [savedShifts, setSavedShifts] = useState(0);
  const [detail, setDetail] = useState<PresenceDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  // The board re-renders every few seconds with a fresh onClose, and the focus
  // effect below must run once per opening, not once per render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const isToday = day === today;
  // Only today moves, so only today re-reads on every board refresh.
  const refreshKey = isToday ? `${refreshedAt}|${savedShifts}` : "";

  useEffect(() => {
    let live = true;
    getOnSitePerson({ siteId, employeeId, day })
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
  }, [siteId, employeeId, day, refreshKey]);

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

  // The detail on screen belongs to the day picked, or it is still loading.
  const shown = detail && detail.day === day ? detail : null;

  const lanes = useMemo(() => {
    if (!shown) return null;
    const from = Date.parse(shown.dayStart);
    const end = Date.parse(shown.dayEnd);
    return buildLanes({
      scans: shown.scans,
      carryGate: shown.carryGate,
      carryClock: shown.carryClock,
      from,
      to: shown.day === shown.today ? Math.min(now, end) : end,
    });
  }, [shown, now]);

  // The list shows the scans that counted; the rest are one quiet line.
  const shownScans = shown ? shown.scans.filter(isShownScan) : [];
  const hiddenScans = shown ? shown.scans.length - shownScans.length : 0;
  const name = person?.name ?? detail?.name ?? "";
  const currentPhoto = usePhoto(employeeId, person?.photoUrl ?? detail?.photoUrl);
  const salaried = person?.salaried ?? detail?.salaried ?? false;
  const meta = person ? STATUS_META[person.status] : null;
  const mins = person ? minutesSince(person.since, now) : null;
  const schedule = shown ? fmtShift(shown.scheduledStart, shown.scheduledEnd) : undefined;
  const label = dayLabel(day, today);
  const oldest = addDays(today, -DAYS_BACK);

  const time = (ms: number) => fmtTime(new Date(ms).toISOString(), tz);
  const where = lanes ? leftBuilding(lanes, hasGateData) : null;
  const stillHere = !!where && isToday && where.onSite;
  const neverOut = !!where && !isToday && where.onSite;
  // Out of the building with the time clock still open: a meal or a break
  // taken outside, or a day the clock never saw end. Said under the exit time
  // so it never reads as a shift that ended normally.
  // Late and early, measured on the time clock as Movements measures them.
  const shiftStart = shown?.scheduledStart ? snapToLocalTime(shown.scheduledStart, day, tz).getTime() : null;
  const shiftEndRaw = shown?.scheduledEnd ? snapToLocalTime(shown.scheduledEnd, day, tz).getTime() : null;
  const shiftEnd =
    shiftStart !== null && shiftEndRaw !== null && shiftEndRaw <= shiftStart ? shiftEndRaw + 24 * 60 * 60 * 1000 : shiftEndRaw;
  const lateOnClock =
    !salaried && !!lanes?.clockIn && shiftStart !== null && lanes.clockIn > shiftStart + LATE_GRACE_MIN * 60000;
  const earlyOnClock =
    !salaried &&
    !!lanes?.clockOut &&
    where?.clock === "OUT" &&
    shiftStart !== null &&
    shiftEnd !== null &&
    lanes.clockOut < shiftEnd - LATE_GRACE_MIN * 60000 &&
    lanes.clockOut > shiftStart;
  const stillOn =
    where && where.leftAt !== null && where.clock !== "OUT"
      ? { MEAL: "On meal", BREAK: "On break", WORK: "Still clocked in" }[where.clock]
      : null;
  const tags = [
    person && isToday && person.outsideOnMeal ? <Badge key="out" tone="neutral" size="sm">Outside the building</Badge> : null,
    salaried ? <Badge key="salary" tone="neutral" size="sm">Office</Badge> : null,
    person?.inactive || detail?.inactive ? <Badge key="inactive" tone="error" size="sm">Inactive employee</Badge> : null,
    detail?.homeSite ?? person?.homeSite ? <HomeSiteBadge key="home" site={detail?.homeSite ?? person?.homeSite ?? null} /> : null,
  ].filter(Boolean);

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={name || "Employee"}>
        <div ref={headRef} className={styles.panelHead}>
          <span className={styles.ppEyebrow}>Employee</span>
          <Button hierarchy="tertiary" size="sm" iconOnly aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className={styles.panelBody}>
          {/* ── Who ── */}
          <div className={styles.ppProfile}>
            <span className={styles.ppPortrait}>
              <span className={styles.initials} style={{ fontSize: 30 }} aria-hidden="true">
                {name ? initialsOf(name) : ""}
              </span>
              <ZoomableFace
                src={person?.photoUrl ?? detail?.photoUrl}
                personId={employeeId}
                name={name}
                onZoom={
                  onZoom &&
                  ((src) =>
                    onZoom(src, {
                      name,
                      detail: [person?.employeeCode ?? detail?.employeeCode, person?.department ?? detail?.department]
                        .filter(Boolean)
                        .join(" · "),
                    }))
                }
              />
              {canEditPhoto && name && (
                <button
                  type="button"
                  className={styles.ppPhotoEdit}
                  aria-label={`Update photo of ${name}`}
                  title="Update photo"
                  onClick={() => setEditingPhoto(true)}
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </span>
            <div className={styles.ppWho}>
              {name ? (
                <h2 className={styles.ppName} title={name}>
                  {name}
                </h2>
              ) : (
                <span className={styles.skeleton} style={{ width: 180, height: 26 }} />
              )}
              <span className={styles.ppRole}>
                {person?.jobTitle ?? detail?.jobTitle ?? person?.department ?? detail?.department ?? ""}
              </span>
              {canViewProfile && (
                <Link href={`/admin/employees/${employeeId}`} className={styles.ppProfileLink}>
                  <UserCircle className="h-4 w-4 flex-none" aria-hidden="true" />
                  View profile
                </Link>
              )}
              {tags.length > 0 && <span className={styles.ppTags}>{tags}</span>}
            </div>
          </div>

          {/* The live status says where they are now, so it only sits beside
              today. On another day the chart says it instead. */}
          {person && meta && isToday && (
            <div className={styles.ppStatus} style={{ ["--pp-tone" as string]: meta.color }}>
              <span className={styles.ppStatusDot} aria-hidden="true" />
              <span className={styles.ppStatusLabel}>{statusLabel(person)}</span>
              <span className={styles.ppStatusText}>{statusSentence(person, tz, mins, new Date(now).toISOString())}</span>
            </div>
          )}

          <dl className={styles.ppFacts}>
            <Fact label="Employee code" value={person?.employeeCode ?? detail?.employeeCode} />
            <Fact label="Department" value={person ? person.department : detail ? detail.department : undefined} />
            <Fact label="Shift" value={detail ? detail.shift : person ? person.shift : undefined} />
            <Fact label="Supervisor" value={detail ? detail.supervisor ?? "None assigned" : undefined} />
          </dl>

          {/* ── The day ── */}
          <section className={styles.ppSection}>
            <div className={styles.ppSectionHead}>
              <h3 className={styles.ppTitle}>Attendance</h3>
              <div className={styles.ppDayPick} role="group" aria-label="Day">
                <button
                  type="button"
                  className={styles.ppDayArrow}
                  aria-label="Previous day"
                  disabled={day <= oldest}
                  onClick={() => setDay((d) => addDays(d, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className={styles.ppDayLabel} aria-live="polite">
                  {label}
                </span>
                <button
                  type="button"
                  className={styles.ppDayArrow}
                  aria-label="Next day"
                  disabled={isToday}
                  onClick={() => setDay((d) => addDays(d, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {failed && !shown ? (
              <p className={styles.ppQuiet}>This day could not be loaded. It will be tried again on the next refresh.</p>
            ) : !shown || !lanes ? (
              <LanesSkeleton />
            ) : (
              <>
                {hasGateData ? (
                  // Two rows that read like the chart under them: the
                  // building on top, the time clock below. The schedule sits
                  // with the clock, since it says when to clock in and out,
                  // not when to walk through the gate.
                  <div className={styles.ppGlance} data-rows="2">
                    <Glance
                      label="Arrived"
                      value={lanes.firstIn ? time(lanes.firstIn) : null}
                      empty={isToday ? "Not in yet" : "Not seen"}
                      sub="Security gate"
                    />
                    <Glance
                      label="Left"
                      value={where?.leftAt ? time(where.leftAt) : null}
                      empty={stillHere ? "On site" : neverOut ? "Never scanned out" : lanes.firstIn ? "Not yet" : "Not seen"}
                      emptyTone={stillHere ? "accent" : neverOut ? "warning" : undefined}
                      sub="Security gate"
                    />
                    <Glance
                      label="Inside"
                      value={lanes.totals.insideMin ? fmtDuration(lanes.totals.insideMin) : null}
                      empty="None"
                      sub="In the building"
                    />
                    <Glance
                      label="Clock in"
                      value={lanes.clockIn ? time(lanes.clockIn) : null}
                      valueTone={lateOnClock ? "warning" : undefined}
                      empty={lanes.clock.length ? "Since yesterday" : salaried ? "Office staff" : "Not clocked in"}
                      sub={salaried ? "Not expected to clock in" : shown.scheduledStart ? `Due ${formatTimeOfDay(shown.scheduledStart)}` : "Not scheduled"}
                    />
                    <Glance
                      label="Clock out"
                      value={lanes.clockOut && where?.clock === "OUT" ? time(lanes.clockOut) : null}
                      valueTone={earlyOnClock ? "warning" : undefined}
                      empty={
                        where && where.clock !== "OUT"
                          ? isToday
                            ? { MEAL: "On meal", BREAK: "On break", WORK: "On the clock" }[where.clock]
                            : "Never clocked out"
                          : lanes.clockIn || lanes.clock.length
                            ? "Not yet"
                            : "None"
                      }
                      emptyTone={where && where.clock !== "OUT" ? (isToday ? "accent" : "warning") : undefined}
                      sub={salaried ? "" : shown.scheduledEnd ? `Ends ${formatTimeOfDay(shown.scheduledEnd)}` : schedule ? "" : "Not scheduled"}
                    />
                    <Glance
                      label="On the clock"
                      value={lanes.totals.workMin ? fmtDuration(lanes.totals.workMin) : null}
                      empty="None"
                      sub="Time clock"
                    />
                  </div>
                ) : (
                  <div className={styles.ppGlance}>
                    <Glance
                      label="Arrived"
                      value={lanes.firstIn ? time(lanes.firstIn) : null}
                      valueTone={lateOnClock ? "warning" : undefined}
                      empty={isToday ? "Not in yet" : "Not seen"}
                      sub={shown.scheduledStart ? `Due ${formatTimeOfDay(shown.scheduledStart)}` : "Not scheduled"}
                    />
                    <Glance
                      label="Left"
                      value={where?.leftAt ? time(where.leftAt) : null}
                      valueTone={earlyOnClock ? "warning" : undefined}
                      empty={stillHere ? "On site" : neverOut ? "Never scanned out" : lanes.firstIn ? "Not yet" : "Not seen"}
                      emptyTone={stillHere ? "accent" : neverOut ? "warning" : undefined}
                      sub={
                        stillOn && isToday
                          ? stillOn
                          : stillOn
                            ? "Never clocked out"
                            : shown.scheduledEnd
                              ? `Ends ${formatTimeOfDay(shown.scheduledEnd)}`
                              : schedule
                                ? ""
                                : "Not scheduled"
                      }
                    />
                    <Glance
                      label="On the clock"
                      value={lanes.totals.workMin ? fmtDuration(lanes.totals.workMin) : null}
                      empty="None"
                      sub=""
                    />
                  </div>
                )}

                {/* Somebody with no shift today, for a viewer who may give
                    them one. Greyed out while the gates still check WMS,
                    because until then a shift here opens no door. */}
                {scheduling && isToday && !shown.scheduledStart && !(person?.inactive || shown.inactive) && (
                  <div className={styles.ppSchedule}>
                    <div className={styles.ppScheduleText}>
                      <span className={styles.ppScheduleTitle}>Not on today&apos;s schedule</span>
                      <span className={styles.ppScheduleSub}>
                        {scheduling.live
                          ? "Add a shift for today so the gate lets them in."
                          : "Available once the gates check CloudTime's schedule."}
                      </span>
                    </div>
                    <Button
                      hierarchy="secondary"
                      size="sm"
                      leadingIcon={<CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />}
                      disabled={!scheduling.live}
                      onClick={() => setAddingShift(true)}
                    >
                      Add to schedule
                    </Button>
                  </div>
                )}

                <Lanes lanes={lanes} detail={shown} hasGateData={hasGateData} tz={tz} now={now} />

                <dl className={styles.ppTotals}>
                  {hasGateData && <Total label="Inside the building" minutes={lanes.totals.insideMin} />}
                  <Total label="On the clock" minutes={lanes.totals.workMin} />
                  <Total label="Meals and breaks" minutes={lanes.totals.mealMin + lanes.totals.breakMin} />
                  {hasGateData && !salaried && (
                    <Total
                      label="Inside, not clocked in"
                      minutes={lanes.totals.insideOffClockMin}
                      hint="In the building, not clocked in, and not on a meal or break"
                      flag
                    />
                  )}
                  {hasGateData && (
                    <Total
                      label="Clocked in, not inside"
                      minutes={lanes.totals.workOutsideMin}
                      hint="Clocked in while the security gate had them outside the building"
                      flag
                    />
                  )}
                </dl>
              </>
            )}
          </section>

          {/* ── Every scan ── */}
          <section className={styles.ppSection}>
            <div className={styles.ppSectionHead}>
              <h3 className={styles.ppTitle}>Scans</h3>
              {shown && (
                <span className={styles.ppCount}>
                  {shownScans.length.toLocaleString()} {shownScans.length === 1 ? "scan" : "scans"}
                </span>
              )}
            </div>
            {failed && !shown ? null : !shown ? (
              <TimelineSkeleton />
            ) : shownScans.length === 0 ? (
              <p className={styles.ppQuiet}>
                {isToday ? "No reader has seen this person today." : "No reader saw this person that day."}
              </p>
            ) : (
              <Timeline scans={shownScans} tz={tz} />
            )}
            {shown && hiddenScans > 0 && (
              <p className={styles.ppFootnote}>
                {hiddenScans.toLocaleString()} more {hiddenScans === 1 ? "tap was" : "taps were"} not counted, usually a
                second tap too soon. The Scan log lists them under Taps not counted.
              </p>
            )}
          </section>
        </div>
      </aside>

      {editingPhoto && (
        <PhotoEditor
          siteId={siteId}
          employeeId={employeeId}
          name={name}
          detail={[person?.employeeCode ?? detail?.employeeCode, person?.jobTitle ?? detail?.jobTitle ?? person?.department ?? detail?.department]
            .filter(Boolean)
            .join(" · ")}
          currentSrc={currentPhoto}
          onClose={() => setEditingPhoto(false)}
          onSaved={(url) => {
            setEditingPhoto(false);
            onPhotoSaved?.(employeeId, url);
          }}
        />
      )}

      {addingShift && scheduling?.live && (
        <ScheduleDayDialog
          siteId={siteId}
          employeeId={employeeId}
          name={name}
          dayLabel={label}
          onClose={() => setAddingShift(false)}
          onSaved={() => {
            setAddingShift(false);
            setSavedShifts((n) => n + 1);
            onScheduled?.();
          }}
        />
      )}
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
      return at ? `Clocked in since ${at}${forHow}, not seen coming in at the gate` : "Clocked in, not seen coming in at the gate";
    case "ON_MEAL":
      return at ? `Started ${p.breakKind === "BREAK" ? "a break" : "a meal"} at ${at}${forHow}` : statusLabel(p);
    case "OFF_CLOCK":
      return at ? `Inside since ${at}${forHow}, not clocked in` : "Inside, not clocked in";
    case "ON_SITE":
      return at ? `Inside since ${at}${forHow}` : "Inside";
    case "LEFT":
      return at ? `Left at ${at}` : "Left";
    case "NOT_ARRIVED":
      if (p.salaried) return "Not seen at any reader yet today";
      return p.lateMinutes !== null ? `${fmtDuration(p.lateMinutes)} past the scheduled start` : "Not due yet";
    case "ON_LEAVE":
      return "Approved time off today";
    case "NOT_SCHEDULED":
      return "Not scheduled today, and not seen at any reader";
  }
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className={styles.ppFact}>
      <dt>{label}</dt>
      {value === undefined ? (
        <dd>
          <span className={styles.skeleton} style={{ width: "60%", height: 14, marginTop: 3 }} />
        </dd>
      ) : (
        <dd title={value ?? undefined}>{value ?? "None"}</dd>
      )}
    </div>
  );
}

/** One of the three numbers the day is read by, with what it is measured against under it. */
function Glance({
  label,
  value,
  empty,
  emptyTone,
  valueTone,
  sub,
}: {
  label: string;
  value: string | null;
  empty: string;
  emptyTone?: "accent" | "warning";
  /** Amber for a time past the schedule: a late clock in, an early clock out. */
  valueTone?: "warning";
  sub: string;
}) {
  return (
    <div className={styles.ppGlanceCell}>
      <span className={styles.ppGlanceLabel}>{label}</span>
      {value ? (
        <span className={styles.ppGlanceValue} data-tone={valueTone}>
          {value}
        </span>
      ) : (
        <span className={styles.ppGlanceValue} data-empty={emptyTone ?? "true"}>
          {empty}
        </span>
      )}
      <span className={styles.ppGlanceSub}>{sub}</span>
    </div>
  );
}

/** A duration in the breakdown. A gap between the readers long enough to matter reads amber. */
function Total({ label, minutes, hint, flag }: { label: string; minutes: number; hint?: string; flag?: boolean }) {
  const noted = flag && minutes >= GAP_WORTH_NOTING_MIN;
  return (
    <div className={styles.ppTotal} title={hint}>
      <dt>{label}</dt>
      <dd data-tone={noted ? "warning" : minutes === 0 ? "quiet" : undefined}>
        {minutes === 0 ? "None" : fmtDuration(minutes)}
      </dd>
    </div>
  );
}

/* ── The two lanes ──────────────────────────────────────────────────────── */

const HOUR = 60 * 60 * 1000;
const hourLabel = new Map<string, Intl.DateTimeFormat>();

function fmtHour(ms: number, timeZone: string): string {
  let f = hourLabel.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: true });
    hourLabel.set(timeZone, f);
  }
  return f.format(new Date(ms));
}

/**
 * Schedule, security gate and time clock on one clock, one lane each. The
 * clock spans the part of the day anything happened in, in whole hours, and
 * never less than eight, so a short day still reads as a day.
 */
function Lanes({
  lanes,
  detail,
  hasGateData,
  tz,
  now,
}: {
  lanes: DayLanes;
  detail: PresenceDetail;
  hasGateData: boolean;
  tz: string;
  now: number;
}) {
  const dayStart = Date.parse(detail.dayStart);
  const dayEnd = Date.parse(detail.dayEnd);
  const isToday = detail.day === detail.today;

  const sched =
    detail.scheduledStart && detail.scheduledEnd
      ? (() => {
          const s = snapToLocalTime(detail.scheduledStart, detail.day, tz).getTime();
          let e = snapToLocalTime(detail.scheduledEnd, detail.day, tz).getTime();
          if (e <= s) e = Math.min(e + 24 * HOUR, dayEnd); // An overnight shift runs to the end of the day.
          return { start: s, end: Math.min(e, dayEnd) };
        })()
      : null;

  // The clock spans whatever happened and whatever was scheduled, then snaps
  // out to labelled hours at both ends, so the frame starts and ends on a
  // label rather than somewhere between two.
  const points = [
    ...lanes.gate.flatMap((g) => [g.start, g.end]),
    ...lanes.clock.flatMap((c) => [c.start, c.end]),
    ...detail.scans.map((s) => Date.parse(s.at)),
    ...(sched ? [sched.start, sched.end] : []),
    ...(isToday ? [Math.min(now, dayEnd)] : []),
  ];
  let lo = points.length ? Math.min(...points) : dayStart + 6 * HOUR;
  let hi = points.length ? Math.max(...points) : dayStart + 18 * HOUR;
  if (hi - lo < 8 * HOUR) {
    hi = Math.min(lo + 8 * HOUR, dayEnd);
    lo = Math.max(hi - 8 * HOUR, dayStart);
  }
  // Hour labels count from the first hour anything happened, so the frame
  // neither opens on empty hours nor ends between two labels. The spacing is
  // whichever leaves the least empty time after the last event, with no more
  // than eight labels across the panel.
  const from = Math.max(dayStart, Math.floor(lo / HOUR) * HOUR);
  const step = [1, 2, 3, 4]
    .map((h) => h * HOUR)
    .filter((st) => Math.ceil((hi - from) / st) + 1 <= 8)
    .reduce((best, st) => {
      const waste = (x: number) => from + Math.ceil((hi - from) / x) * x - hi;
      return best === 0 || waste(st) < waste(best) ? st : best;
    }, 0) || 4 * HOUR;
  const to = Math.min(dayEnd, from + Math.ceil((hi - from) / step) * step);
  const span = Math.max(to - from, HOUR);
  const clamp = (t: number) => Math.min(Math.max(t, from), to);
  const pct = (t: number) => `${(((clamp(t) - from) / span) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) => `${(((clamp(b) - clamp(a)) / span) * 100).toFixed(3)}%`;
  const ticks: number[] = [];
  for (let t = from; t <= to; t += step) ticks.push(t);

  const time = (ms: number) => fmtTime(new Date(ms).toISOString(), tz);
  const until = (s: { end: number; open: boolean }) =>
    s.open ? (isToday ? "now" : "the end of the day, never scanned out") : time(s.end);
  // A stretch still running is pinned to now from the right, so a meal that
  // has only just started grows back into the bar, never past the now line.
  const place = (s: { start: number; end: number; open: boolean }) =>
    s.open && isToday
      ? { right: `calc(100% - ${pct(s.end)})`, width: width(s.start, s.end) }
      : { left: pct(s.start), width: width(s.start, s.end) };

  // An hour label that would touch the "Now" label under it gives way. An
  // edge label is drawn to one side of its hour, so it needs more room.
  const crowdsNow = (t: number) => {
    const gap = Math.abs(t - now) / span;
    return t === to || t === from ? gap < 0.17 : gap < 0.1;
  };

  // Today the record ends now: the track stops there, and what is left of
  // the scheduled day is drawn as an outline still to come.
  const recordedTo = isToday ? clamp(Math.min(now, dayEnd)) : to;
  const nowAt = isToday && now > from && now < to ? pct(now) : null;
  const ahead = isToday && sched && sched.end > recordedTo ? { start: Math.max(recordedTo, sched.start), end: sched.end } : null;

  // The clock is one bar per stretch on the clock: a meal inside it is a
  // notch, not a separate piece, so only the ends of a run are rounded.
  const clock = [...lanes.clock].sort((a, b) => a.start - b.start);
  const runEdge = (i: number) => ({
    first: i === 0 || clock[i - 1].end !== clock[i].start,
    last: i === clock.length - 1 || clock[i + 1].start !== clock[i].end,
  });

  const track = (children: ReactNode, empty: string | null, reporting = true) => (
    <span className={styles.ppTrack}>
      <span className={styles.ppTrackBg} style={{ width: width(from, reporting ? recordedTo : to) }} />
      {ahead && reporting && (
        <span className={styles.ppAhead} style={{ left: pct(ahead.start), width: width(ahead.start, ahead.end) }} />
      )}
      {empty ? <span className={styles.laneEmpty}>{empty}</span> : children}
    </span>
  );

  return (
    <div className={styles.ppChart}>
      <div className={styles.ppChartBody}>
        <span className={styles.ppLabel}>Scheduled</span>
        <span className={styles.ppSchedRow}>
          {sched ? (
            <span
              className={styles.ppSchedLine}
              style={{ left: pct(sched.start), width: width(sched.start, sched.end) }}
              title={`Scheduled ${time(sched.start)} to ${time(sched.end)}`}
            >
              <span className={styles.ppSchedText}>
                {time(sched.start)} to {time(sched.end)}
              </span>
            </span>
          ) : (
            <span className={styles.ppSchedNone}>Not scheduled</span>
          )}
        </span>

        <span className={styles.ppLabel}>Security gate</span>
        <span className={styles.ppLane}>
          {ticks.map((t) => (
            <span key={t} className={styles.ppGrid} style={{ left: pct(t) }} aria-hidden="true" />
          ))}
          {track(
            lanes.gate.map((g) => (
              <span
                key={g.start}
                className={styles.ppSeg}
                data-kind="inside"
                data-first="true"
                data-last={g.open && isToday ? undefined : "true"}
                data-open={g.open && !isToday ? "true" : undefined}
                style={place(g)}
                title={`Inside ${time(g.start)} to ${until(g)} (${fmtDuration((g.end - g.start) / 60000)})${
                  g.closedBySystem ? ". Never scanned out, closed by the system" : ""
                }`}
              />
            )),
            !hasGateData ? "Not reporting at this site" : lanes.gate.length === 0 ? "Not inside" : null,
            hasGateData,
          )}
          {nowAt && <span className={styles.ppNow} style={{ left: nowAt }} aria-hidden="true" />}
        </span>

        <span className={styles.ppLabel}>Time clock</span>
        <span className={styles.ppLane}>
          {ticks.map((t) => (
            <span key={t} className={styles.ppGrid} style={{ left: pct(t) }} aria-hidden="true" />
          ))}
          {track(
            clock.map((c, i) => {
              const edge = runEdge(i);
              return (
                <span
                  key={c.start}
                  className={styles.ppSeg}
                  data-kind={c.kind === "WORK" ? "work" : "meal"}
                  data-first={edge.first ? "true" : undefined}
                  data-last={edge.last && !(c.open && isToday) ? "true" : undefined}
                  data-open={c.open && !isToday ? "true" : undefined}
                  style={place(c)}
                  title={`${c.kind === "WORK" ? "On the clock" : c.kind === "MEAL" ? "Meal" : "Break"} ${time(c.start)} to ${until(c)} (${fmtDuration(
                    (c.end - c.start) / 60000,
                  )})${c.closedBySystem ? ". Clocked out by the system" : ""}`}
                />
              );
            }),
            clock.length === 0 ? "Not clocked in" : null,
          )}
          {nowAt && <span className={styles.ppNow} style={{ left: nowAt }} aria-hidden="true" />}
        </span>

        <span />
        <span className={styles.ppAxis} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }} data-edge={t === from ? "start" : t === to ? "end" : undefined}>
              {nowAt && crowdsNow(t) ? "" : fmtHour(t, tz)}
            </span>
          ))}
          {nowAt && (
            <span
              className={styles.ppNowLabel}
              style={{ left: nowAt }}
              data-edge={now > to - span * 0.04 ? "end" : now < from + span * 0.04 ? "start" : undefined}
            >
              Now
            </span>
          )}
        </span>
      </div>

      <div className={styles.ppKey}>
        {hasGateData && (
          <span>
            <i data-kind="inside" /> Inside
          </span>
        )}
        <span>
          <i data-kind="work" /> On the clock
        </span>
        <span>
          <i data-kind="meal" /> Meal or break
        </span>
        {ahead && (
          <span>
            <i data-kind="ahead" /> Rest of the shift
          </span>
        )}
      </div>
    </div>
  );
}

function LanesSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className="flex items-center gap-3">
          <span className={styles.skeleton} style={{ width: 84, height: 12 }} />
          <span className={styles.skeleton} style={{ flex: 1, height: 20 }} />
        </span>
      ))}
    </div>
  );
}

/* ── The scans, one by one ──────────────────────────────────────────────── */

function Timeline({ scans, tz }: { scans: PresenceScan[]; tz: string }) {
  return (
    <ol className={styles.ppTimeline}>
      {scans.map((s) => {
        const { icon, kind } = iconFor(s);
        const notes = [
          s.stream === "SECURITY" ? "Security gate" : "Time clock",
          s.device,
          s.automatic ? "Added by the system" : null,
          s.correctedFrom ? `corrected, recorded as ${describeOriginal(s)?.toLowerCase()}` : null,
        ].filter(Boolean);
        return (
          <li key={s.id} className={styles.ppEvent}>
            <span className={styles.eventTime}>{fmtTime(s.at, tz)}</span>
            <span className={styles.eventIcon} data-kind={s.rejected ? "error" : kind} aria-hidden="true">
              {icon}
            </span>
            <span className={styles.eventText}>
              <span style={{ font: "var(--weight-medium) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>
                {describeScan(s)}
              </span>
              <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                {notes.join(" · ")}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function iconFor(s: PresenceScan): { icon: ReactNode; kind: "in" | "out" | "meal" | "error" } {
  const cls = "h-3.5 w-3.5";
  if (s.stream === "SECURITY") {
    return s.direction === "IN"
      ? { icon: <DoorOpen className={cls} />, kind: "in" }
      : { icon: <DoorClosed className={cls} />, kind: "out" };
  }
  if (s.punchType === "MEAL_START" || s.punchType === "BREAK_START") return { icon: <Coffee className={cls} />, kind: "meal" };
  if (s.punchType === "MEAL_END" || s.punchType === "BREAK_END") return { icon: <Clock className={cls} />, kind: "in" };
  // The words say what the timecard made of the scan, so the icon does too.
  if (s.punchType === "CLOCK_IN") return { icon: <Clock className={cls} />, kind: "in" };
  if (s.punchType === "CLOCK_OUT") return { icon: <Clock className={cls} />, kind: "out" };
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
