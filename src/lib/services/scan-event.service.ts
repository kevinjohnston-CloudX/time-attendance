import { db } from "@/lib/db";
import { findEmployeeIdentityByBadge } from "@/lib/utils/badge-lookup";
import { snapToLocalTime } from "@/lib/utils/date";
import type {
  Prisma,
  ScanDirection,
  ScanDirectionSource,
  ScanOutcome,
  ScanStream,
} from "@prisma/client";

/**
 * The tablets' transaction log — recording, direction resolution, and the
 * comparison against timecards that {@code detect-scan-discrepancies} reports on.
 *
 * <b>The rule this file exists to enforce:</b> nothing here is derived from the
 * punch pipeline. A scan is written down before that pipeline runs and its
 * direction is worked out from this table alone, so the two can be compared
 * afterwards. A log that copied the pipeline's conclusions could never
 * contradict them, and contradiction is the only thing that makes it useful.
 */

export type RecordedScan = {
  id: string;
  direction: ScanDirection;
  stream: ScanStream;
  scanTime: Date;
  employeeId: string | null;
  employeeName: string | null;
  /**
   * True when this exact scan was already stored — a retry, not a new event.
   *
   * <p>This is what makes the punch endpoint idempotent. The kiosk retries a
   * post until the server acknowledges it, and a response lost on the way back
   * would otherwise be replayed as a second punch — which, because the
   * employee is now clocked in, would be classified as a clock OUT. One
   * physical scan must never produce two punches, and (badge, stream, scanTime)
   * is what identifies the physical scan.
   */
  duplicate: boolean;
  /**
   * True when this is a distinct scan that arrived inside the stream's re-read
   * window (see {@link rereadWindowMsFor}) of the same badge's previous one in
   * the same stream — the reader firing twice rather than the person crossing.
   *
   * <p>Unlike {@link duplicate} the row IS stored: it is what the reader did,
   * and Oracle logs both crossings too, so dropping it would make the two
   * impossible to reconcile. It simply inherits the previous direction rather
   * than alternating off it.
   *
   * <p>The kiosk uses this to say "you already scanned a moment ago" instead of
   * announcing a crossing that did not happen.
   */
  reread: boolean;
  /** On a duplicate, what the pipeline already concluded the first time. */
  outcome: ScanOutcome;
  /** On a duplicate that already produced a punch, that punch's id. */
  punchId: string | null;
  timecardPunchType: string | null;
  timecardStateAfter: string | null;
  legacyMismatch: boolean;
};

export type RecordScanInput = {
  badgeCode: string;
  stream: ScanStream;
  scanTime: Date;
  deviceName?: string | null;
  /** Reader location. Text: the clocks report NJ299/NJ3/CA2, the gates report ids. */
  site?: string | null;
  /**
   * Which slot of a legacy report row this came from — TIMECLOCKIN,
   * TIMECLOCKOUT, SCANTIME, OUTTIME. Omitted for live kiosk scans, which
   * default to 'LIVE'. When set, `direction` is taken from it as fact.
   */
  sourceSlot?: string;
  /** The legacy row this was expanded from, for tracing back to the report. */
  sourceRef?: string | null;
  /**
   * Direction stated by the source, when there is one. Supplying this skips
   * alternation entirely and stores the row as SOURCE_COLUMN.
   */
  knownDirection?: ScanDirection;
  /** Gate scans never enter the timecard pipeline, so they start resolved. */
  outcome?: ScanOutcome;
  /** What cajaapi said, recorded for reconciliation only. */
  legacyScanType?: string | null;
  /** The kiosk build that recorded this scan. Null from anything before 154. */
  appVersion?: string | null;
  note?: string | null;
};

/**
 * The UTC instant of local midnight on the day `scanTime` falls in.
 *
 * Note this is not `startOfDayInTz`, which returns UTC midnight of the local
 * calendar date — four hours adrift from local midnight in New York, enough to
 * pull the previous evening's scans into today's window.
 */
function localMidnightUtc(scanTime: Date, timezone: string): Date {
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(scanTime);
  return snapToLocalTime("00:00", localDate, timezone);
}

/**
 * Alternates from the employee's previous scan in the same stream.
 *
 * Resolved against the previous event *by scan time* rather than by arrival,
 * because an offline tablet flushes its queue out of order — a scan from 06:02
 * can land after one from 06:47.
 *
 * <b>TIME_CLOCK re-anchors at local midnight; SECURITY does not.</b> Unbounded
 * alternation has no re-sync point, so a single unpaired scan inverts every
 * later scan for that badge until another unpaired one happens to flip it back.
 * That is not rare: replaying two months of production logs, 689 of 789 badges
 * had at least one shift with no clock-out, and the resulting error rate was
 * 22.5% of all time-clock events.
 *
 * Anchoring the time clock to "the first scan of the local day is an arrival"
 * takes that to 0.03% (12 events in 44,501), and is safe because not one of the
 * 22,799 shifts in those logs crossed midnight. Applying the same anchor to
 * SECURITY makes it far worse — 0.38% to 5.08% — because 685 gate visits DO
 * cross midnight on night shift, and a midnight reset calls every one of those
 * exits an entry. The two streams genuinely need different rules.
 *
 * With no previous event inside the window the answer is IN: the first scan of
 * someone's day is an arrival. For SECURITY that default is only reached once
 * per badge ever, which is what the gate-state seed exists to pre-empt.
 */
async function resolveDirection(
  tx: Prisma.TransactionClient,
  employeeId: string,
  stream: ScanStream,
  scanTime: Date,
  timezone: string,
): Promise<ScanDirection> {
  const anchor = stream === "TIME_CLOCK" ? localMidnightUtc(scanTime, timezone) : null;

  const previous = await tx.scanEvent.findFirst({
    where: {
      employeeId,
      stream,
      scanTime: anchor ? { lt: scanTime, gte: anchor } : { lt: scanTime },
      direction: { in: ["IN", "OUT"] },
    },
    orderBy: { scanTime: "desc" },
    select: { direction: true },
  });

  if (!previous) return "IN";
  return previous.direction === "IN" ? "OUT" : "IN";
}

/**
 * Repairs the alternation after a scan is inserted into the past.
 *
 * Without this, a queued scan that arrives late leaves every event after it
 * holding the direction it was given before the gap was filled — so a tablet
 * coming back online would silently invert an employee's whole day.
 */
async function reresolveFollowing(
  tx: Prisma.TransactionClient,
  employeeId: string,
  stream: ScanStream,
  afterScanTime: Date,
  startingFrom: ScanDirection,
  timezone: string,
): Promise<number> {
  // Bounded by the same anchor `resolveDirection` uses, or the correction would
  // run past the point where the chain restarts and "fix" rows that were right.
  const dayEnd =
    stream === "TIME_CLOCK"
      ? new Date(localMidnightUtc(afterScanTime, timezone).getTime() + 24 * 60 * 60 * 1000)
      : null;

  const following = await tx.scanEvent.findMany({
    where: {
      employeeId,
      stream,
      scanTime: dayEnd ? { gt: afterScanTime, lt: dayEnd } : { gt: afterScanTime },
      direction: { in: ["IN", "OUT"] },
      // Never rewrite a direction the source stated. Only guesses are ours to
      // revise; a TIMECLOCKOUT is an out no matter what the chain implies.
      directionSource: "ALTERNATION",
    },
    orderBy: { scanTime: "asc" },
    select: { id: true, direction: true },
  });

  let expected: ScanDirection = startingFrom === "IN" ? "OUT" : "IN";
  let corrected = 0;

  for (const event of following) {
    if (event.direction !== expected) {
      await tx.scanEvent.update({
        where: { id: event.id },
        data: {
          direction: expected,
          note: "direction re-resolved after a late scan filled an earlier gap",
        },
      });
      corrected += 1;
    }
    expected = expected === "IN" ? "OUT" : "IN";
  }

  return corrected;
}

/**
 * Stores one tablet transaction and returns the direction it resolved to.
 *
 * Call this as soon as a scan payload is understood — before any timecard
 * work — then report what the pipeline did with {@link resolveScanOutcome}.
 *
 * Idempotent on (badgeCode, stream, scanTime): the kiosk queue retries a scan
 * until the server accepts it, and a retry must return the direction already
 * recorded rather than toggling the stream a second time.
 *
 * An unmatched badge is still stored, with no employee and UNKNOWN direction.
 * Those rows are the ones anyone actually asks about later, and dropping them
 * would leave nothing to answer with.
 */
export async function recordScanEvent(input: RecordScanInput): Promise<RecordedScan> {
  // Matches either badge form — see badge-lookup for why both exist.
  const employee = await findEmployeeIdentityByBadge(input.badgeCode);

  const employeeName = employee?.user?.name?.trim() || null;

  const existing = await db.scanEvent.findUnique({
    where: {
      badgeCode_stream_scanTime_sourceSlot: {
        badgeCode: input.badgeCode,
        stream: input.stream,
        scanTime: input.scanTime,
        sourceSlot: input.sourceSlot ?? "LIVE",
      },
    },
    select: {
      id: true, direction: true, legacyMismatch: true,
      outcome: true, punchId: true,
      timecardPunchType: true, timecardStateAfter: true,
    },
  });

  if (existing) {
    return {
      id: existing.id,
      direction: existing.direction,
      stream: input.stream,
      scanTime: input.scanTime,
      employeeId: employee?.id ?? null,
      employeeName,
      duplicate: true,
      // A retry of a scan already stored is not a re-read of the badge: the
      // reader fired once and the kiosk asked twice.
      reread: false,
      outcome: existing.outcome,
      punchId: existing.punchId,
      timecardPunchType: existing.timecardPunchType,
      timecardStateAfter: existing.timecardStateAfter,
      legacyMismatch: existing.legacyMismatch,
    };
  }

  const timezone = employee?.site?.timezone ?? "America/New_York";

  const created = await db.$transaction(async (tx) => {
    // A re-read: the same badge at the same kind of reader again within a
    // minute. Checked before direction is resolved, because the whole point is
    // that it must NOT alternate off the scan it is repeating.
    //
    // Only for live scans. A backfilled report row carries its direction as
    // fact and two legacy slots can legitimately share a timestamp.
    const prior =
      employee && (input.sourceSlot ?? "LIVE") === "LIVE"
        ? await tx.scanEvent.findFirst({
            where: {
              employeeId: employee.id,
              stream: input.stream,
              sourceSlot: "LIVE",
              direction: { in: ["IN", "OUT"] },
              scanTime: {
                lt: input.scanTime,
                gte: new Date(
                  input.scanTime.getTime() - rereadWindowMsFor(input.stream),
                ),
              },
            },
            orderBy: { scanTime: "desc" },
            select: { direction: true, scanTime: true },
          })
        : null;

    // A direction the source stated is a fact, and is taken as-is even when no
    // employee matched — TIMECLOCKOUT is an out whether or not we know whose.
    // Otherwise: no employee means no stream to alternate within, and nothing
    // honest to say about direction.
    const direction: ScanDirection = prior
      ? prior.direction
      : input.knownDirection ??
        (employee
          ? await resolveDirection(tx, employee.id, input.stream, input.scanTime, timezone)
          : "UNKNOWN");

    const directionSource: ScanDirectionSource = prior
      ? "REREAD"
      : input.knownDirection
        ? "SOURCE_COLUMN"
        : "ALTERNATION";

    const legacy = normaliseLegacyScanType(input.legacyScanType);
    // On a re-read the source almost always disagrees, because the legacy
    // system alternates on the repeat exactly as we used to. That disagreement
    // is explained by construction, so flagging it would drown the signal this
    // field exists for. The legacy answer is still stored, so the two systems
    // remain reconcilable — which is the reason the row is kept at all.
    const legacyMismatch =
      !prior && legacy !== null && direction !== "UNKNOWN" && legacy !== direction;

    const event = await tx.scanEvent.create({
      data: {
        tenantId: employee?.tenantId ?? null,
        employeeId: employee?.id ?? null,
        badgeCode: input.badgeCode,
        stream: input.stream,
        direction,
        directionSource,
        scanTime: input.scanTime,
        deviceName: input.deviceName ?? null,
        appVersion: input.appVersion ?? null,
        site: input.site ?? null,
        sourceSlot: input.sourceSlot ?? "LIVE",
        sourceRef: input.sourceRef ?? null,
        outcome: input.outcome ?? (employee ? "PENDING" : "NO_EMPLOYEE"),
        legacyScanType: legacy,
        legacyMismatch,
        note:
          input.note ??
          (prior
            ? `re-read ${Math.round(
                (input.scanTime.getTime() - prior.scanTime.getTime()) / 1000,
              )}s after ${prior.scanTime.toISOString()}; kept ${prior.direction}` +
              (legacy && legacy !== prior.direction ? `, source said ${legacy}` : "")
            : employee
              ? null
              : "no employee matches this badge"),
      },
      select: { id: true, direction: true, legacyMismatch: true, outcome: true },
    });

    // Only a guessed direction disturbs the chain that follows it. A row whose
    // direction came from the source is an anchor, not a perturbation.
    if (employee && direction !== "UNKNOWN" && directionSource === "ALTERNATION") {
      await reresolveFollowing(
        tx, employee.id, input.stream, input.scanTime, direction, timezone,
      );
    }

    return { ...event, reread: prior !== null };
  });

  return {
    id: created.id,
    direction: created.direction,
    stream: input.stream,
    scanTime: input.scanTime,
    employeeId: employee?.id ?? null,
    employeeName,
    duplicate: false,
    reread: created.reread,
    outcome: created.outcome,
    punchId: null,
    timecardPunchType: null,
    timecardStateAfter: null,
    legacyMismatch: created.legacyMismatch,
  };
}

/**
 * How close together two reads of the same badge have to be before the second
 * is the reader repeating itself rather than the person crossing again.
 *
 * <p>Sixty seconds, taken from the measured distribution rather than taste.
 * Across 447 consecutive gate scan pairs since 2026-09-17: 153 under 30s, 11 in
 * the 30-60s band, then only 2 between one and two minutes before ordinary
 * traffic resumes. The cliff sits well inside a minute, so this catches
 * essentially all the repeats and almost nothing real.
 */
export const REREAD_WINDOW_MS = 60_000;

/**
 * The gate's own window, which is shorter so that somebody who turns straight
 * back round is allowed to record it instead of being told they already entered.
 *
 * <p>Twelve seconds, chosen rather than derived. Sixty was measured, five was
 * tried on 2026-09-22, and this is where it settled. Over the fourteen days to
 * that date, 248 gate pairs fell under twelve seconds apart and stay suppressed
 * here, while 187 sit in the twelve-to-sixty band and now count as crossings.
 * 107 of those 187 are ones sixty seconds was absorbing, so this gives up about
 * eight suppressed repeats a day.
 *
 * <p>What that costs is known rather than guessed. Of the 253 pairs the sixty
 * second window absorbed between five and sixty seconds, 100 are followed by a
 * time clock punch from the same badge inside ninety minutes, which is proof the
 * person never left, and 97 more have no further gate scan for over six hours,
 * which is the shape of a repeat read followed by the real end-of-shift exit.
 * Each one that now counts is a crossing that did not happen, and a crossing
 * that did not happen inverts every scan the badge makes for the rest of the day.
 *
 * <p>There is no cliff to aim for below a minute. The gaps run 145 pairs at five
 * to ten seconds, 244 at ten to thirty and 35 at thirty to sixty, so a value in
 * this range is a judgement about how much repeat-suppression to trade away, not
 * a closer reading of the data.
 *
 * <p>Which is why it is settable without a deploy. GATE_REREAD_WINDOW_MS in the
 * Vercel environment overrides it, and setting it to 60000 restores the old
 * behaviour at the gate. That is the lever to reach for if inverted directions
 * reappear at NJ299, rather than a revert.
 */
export const GATE_REREAD_WINDOW_MS = readWindowMs("GATE_REREAD_WINDOW_MS", 12_000);

function readWindowMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  // A typo in an environment variable must not silently disable the guard that
  // keeps a repeat read from inverting somebody's day.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Security repeats itself far more than the clock does, and matters more. */
export function rereadWindowMsFor(stream: ScanStream): number {
  return stream === "SECURITY" ? GATE_REREAD_WINDOW_MS : REREAD_WINDOW_MS;
}

/**
 * Records what the timecard pipeline did with a scan already written down.
 *
 * Deliberately never throws: this is bookkeeping on a reporting table, and a
 * failure here must not cost an employee a punch the pipeline already
 * accepted. A scan left at PENDING because this failed is itself visible to
 * the discrepancy sweep, which is the right outcome.
 */
export async function resolveScanOutcome(
  scanEventId: string,
  result: {
    outcome: ScanOutcome;
    punchId?: string | null;
    punchType?: string | null;
    stateAfter?: string | null;
    rejectionReason?: string | null;
  },
): Promise<void> {
  try {
    await db.scanEvent.update({
      where: { id: scanEventId },
      data: {
        outcome: result.outcome,
        punchId: result.punchId ?? null,
        timecardPunchType: result.punchType ?? null,
        timecardStateAfter: result.stateAfter ?? null,
        rejectionReason: result.rejectionReason ?? null,
      },
    });
  } catch (err) {
    console.error("scan_events: failed to resolve outcome for", scanEventId, err);
  }
}

/**
 * Accepts the legacy API's "IN" / "OUT" in any casing; anything else is dropped.
 *
 * Exported because the gate ingest route passes the same value as
 * `knownDirection`, and a second copy of this parse would be free to drift from
 * this one — which, for a field that decides whether a scan is an arrival or a
 * departure, is not a drift anybody would notice until it mattered.
 */
export function normaliseLegacyScanType(value?: string | null): ScanDirection | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return upper === "IN" || upper === "OUT" ? upper : null;
}

/* ------------------------------------------------------------------ */
/*  Reading current state                                              */
/* ------------------------------------------------------------------ */

/**
 * Where this employee currently stands in each stream, independently.
 *
 * SECURITY answers "are they in the building", TIME_CLOCK answers "did the
 * tablets last see them clock in" — note that is the tablets' view, not the
 * timecard's. Where the two disagree, that disagreement is the finding.
 */
export async function getCurrentScanState(employeeId: string): Promise<{
  security: { direction: ScanDirection; at: Date | null };
  timeClock: { direction: ScanDirection; at: Date | null };
}> {
  const [security, timeClock] = await Promise.all([
    latestInStream(employeeId, "SECURITY"),
    latestInStream(employeeId, "TIME_CLOCK"),
  ]);
  return { security, timeClock };
}

async function latestInStream(employeeId: string, stream: ScanStream) {
  const latest = await db.scanEvent.findFirst({
    where: { employeeId, stream, direction: { in: ["IN", "OUT"] } },
    orderBy: { scanTime: "desc" },
    select: { direction: true, scanTime: true },
  });
  return latest
    ? { direction: latest.direction, at: latest.scanTime }
    : { direction: "OUT" as ScanDirection, at: null };
}

/** Everyone currently showing as present at the gate. */
export async function getEmployeesOnSite(tenantId: string) {
  const rows = await db.$queryRaw<
    Array<{ employeeId: string; scanTime: Date; direction: ScanDirection }>
  >`
    SELECT DISTINCT ON ("employeeId") "employeeId", "scanTime", "direction"
    FROM   "scan_events"
    WHERE  "tenantId" = ${tenantId}
      AND  "stream" = 'SECURITY'
      AND  "employeeId" IS NOT NULL
      AND  "direction" IN ('IN', 'OUT')
    ORDER  BY "employeeId", "scanTime" DESC
  `;
  return rows.filter((r) => r.direction === "IN");
}

/* ------------------------------------------------------------------ */
/*  Discrepancies: the tablets' record vs the timecard                 */
/* ------------------------------------------------------------------ */

export type DiscrepancyKind =
  | "NO_PUNCH"
  | "REJECTED"
  | "UNRESOLVED"
  | "NO_EMPLOYEE"
  | "DIRECTION_MISMATCH"
  | "GATE_CONTRADICTS_CLOCK";

/**
 * How close a time-clock punch has to be to a gate scan to witness it.
 *
 * Arrivals badge the gate and then clock in; departures clock out and then
 * badge the gate. Ninety minutes covers the walk in both directions with room
 * for a queue at the clock, and is short enough that a lunch break does not
 * pair a morning arrival with a midday exit.
 */
const GATE_WITNESS_WINDOW_MS = 90 * 60_000;

export type Discrepancy = {
  scanEventId: string;
  kind: DiscrepancyKind;
  employeeId: string | null;
  employeeName: string | null;
  badgeCode: string;
  deviceName: string | null;
  scanTime: Date;
  stream: ScanStream;
  scanDirection: ScanDirection;
  timecardPunchType: string | null;
  timecardStateAfter: string | null;
  rejectionReason: string | null;
  description: string;
};

/**
 * Every tablet scan in the window that the timecard does not cleanly account
 * for.
 *
 * TIME_CLOCK scans get the punch checks. Gate scans get exactly one check of
 * their own, at the end: a gate row never produces a punch, so "no punch" is
 * its normal state — but the direction it GUESSED can be judged against the
 * time clock, which is an independent witness.
 *
 * `to` is exclusive. Pass a window that has closed: a scan taken seconds ago is
 * legitimately still PENDING.
 */
export async function findScanDiscrepancies(
  from: Date,
  to: Date,
  tenantId?: string,
): Promise<Discrepancy[]> {
  const scans = await db.scanEvent.findMany({
    where: {
      stream: "TIME_CLOCK",
      scanTime: { gte: from, lt: to },
      ...(tenantId ? { tenantId } : {}),
    },
    orderBy: { scanTime: "asc" },
    include: { employee: { select: { user: { select: { name: true } } } } },
  });

  const out: Discrepancy[] = [];

  for (const s of scans) {
    const base = {
      scanEventId: s.id,
      employeeId: s.employeeId,
      employeeName: s.employee?.user?.name?.trim() ?? null,
      badgeCode: s.badgeCode,
      deviceName: s.deviceName,
      scanTime: s.scanTime,
      stream: s.stream,
      scanDirection: s.direction,
      timecardPunchType: s.timecardPunchType,
      timecardStateAfter: s.timecardStateAfter,
      rejectionReason: s.rejectionReason,
    };

    const when = s.scanTime.toISOString();

    if (s.outcome === "NO_EMPLOYEE") {
      out.push({ ...base, kind: "NO_EMPLOYEE",
        description: `Badge ${s.badgeCode} scanned at ${s.deviceName ?? "an unknown device"} on ${when} matches no employee, so no punch could be recorded.` });
      continue;
    }

    if (s.outcome === "PUNCH_REJECTED") {
      out.push({ ...base, kind: "REJECTED",
        description: `A scan at ${s.deviceName ?? "an unknown device"} on ${when} was refused by the timecard system: ${s.rejectionReason ?? "no reason given"}. No punch exists for it.` });
      continue;
    }

    if (s.outcome === "ERROR") {
      out.push({ ...base, kind: "NO_PUNCH",
        description: `A scan at ${s.deviceName ?? "an unknown device"} on ${when} failed while being recorded: ${s.rejectionReason ?? "unknown error"}. No punch exists for it.` });
      continue;
    }

    if (s.outcome === "PENDING") {
      out.push({ ...base, kind: "UNRESOLVED",
        description: `A scan at ${s.deviceName ?? "an unknown device"} on ${when} was never resolved — the timecard system did not report back. No punch exists for it.` });
      continue;
    }

    if (s.outcome === "PUNCH_RECORDED") {
      if (!s.punchId) {
        out.push({ ...base, kind: "NO_PUNCH",
          description: `A scan at ${s.deviceName ?? "an unknown device"} on ${when} is marked recorded but has no punch attached.` });
        continue;
      }
      // Both systems answered. Do they agree which way the employee went?
      const timecardDirection = s.timecardStateAfter === "WORK" ? "IN" : "OUT";
      if (s.direction !== "UNKNOWN" && s.direction !== timecardDirection) {
        out.push({ ...base, kind: "DIRECTION_MISMATCH",
          description: `The tablets' record says this ${when} scan was a clock ${s.direction}, but the timecard recorded ${s.timecardPunchType ?? "a punch"} leaving the employee ${s.timecardStateAfter ?? "unknown"}. One of the two has missed a punch.` });
      }
    }
  }

  // Gate direction is inferred by alternation, and alternation is only right
  // when every crossing was seen. When a reader CloudTime is not connected to
  // takes the morning arrivals, the evening exit is the first thing CloudTime
  // sees and it is called IN — 91 times at NJ299 and 16 at NJ3 on 2026-09-22.
  // The time clock saw those same people clock OUT minutes before. That is the
  // contradiction surfaced here, the same day, in the exceptions view.
  //
  // Only guessed rows are judged: SOURCE_COLUMN and AUTO_CLOSE state a fact.
  // The witness is asymmetric on purpose. A clock-out shortly BEFORE the gate
  // means leaving; a clock-in shortly AFTER the gate means arriving. A clock-in
  // before the gate is not a witness — that is someone stepping out after
  // starting work, and the gate calling it OUT is correct.
  const gateScans = await db.scanEvent.findMany({
    where: {
      stream: "SECURITY",
      employeeId: { not: null },
      direction: { in: ["IN", "OUT"] },
      directionSource: { in: ["ALTERNATION", "REREAD"] },
      scanTime: { gte: from, lt: to },
      ...(tenantId ? { tenantId } : {}),
    },
    orderBy: { scanTime: "asc" },
    select: {
      id: true, employeeId: true, badgeCode: true, deviceName: true,
      scanTime: true, stream: true, direction: true,
      employee: { select: { user: { select: { name: true } } } },
    },
  });

  for (const g of gateScans) {
    const employeeId = g.employeeId as string;
    const [before, after] = await Promise.all([
      db.scanEvent.findFirst({
        where: {
          employeeId, stream: "TIME_CLOCK", outcome: "PUNCH_RECORDED",
          timecardStateAfter: { not: null },
          scanTime: { gte: new Date(g.scanTime.getTime() - GATE_WITNESS_WINDOW_MS), lte: g.scanTime },
        },
        orderBy: { scanTime: "desc" },
        select: { scanTime: true, timecardStateAfter: true, timecardPunchType: true },
      }),
      db.scanEvent.findFirst({
        where: {
          employeeId, stream: "TIME_CLOCK", outcome: "PUNCH_RECORDED",
          timecardPunchType: "CLOCK_IN",
          scanTime: { gte: g.scanTime, lte: new Date(g.scanTime.getTime() + GATE_WITNESS_WINDOW_MS) },
        },
        orderBy: { scanTime: "asc" },
        select: { scanTime: true, timecardStateAfter: true, timecardPunchType: true },
      }),
    ]);

    // Leaving: clocked out, then badged the gate.
    const leaving = before && before.timecardStateAfter !== "WORK" ? before : null;
    // Arriving: badged the gate, then clocked in.
    const arriving = after ?? null;
    // Both within the window is a short break, not a verdict.
    if ((leaving && arriving) || (!leaving && !arriving)) continue;

    const expected: ScanDirection = leaving ? "OUT" : "IN";
    if (expected === g.direction) continue;

    const witness = (leaving ?? arriving)!;
    out.push({
      scanEventId: g.id,
      kind: "GATE_CONTRADICTS_CLOCK",
      employeeId,
      employeeName: g.employee?.user?.name?.trim() ?? null,
      badgeCode: g.badgeCode,
      deviceName: g.deviceName,
      scanTime: g.scanTime,
      stream: g.stream,
      scanDirection: g.direction,
      timecardPunchType: witness.timecardPunchType,
      timecardStateAfter: witness.timecardStateAfter,
      rejectionReason: null,
      description:
        `The gate at ${g.deviceName ?? "an unknown reader"} recorded the ${g.scanTime.toISOString()} scan as ${g.direction}, ` +
        `but the employee ${leaving ? "clocked out" : "clocked in"} at ${witness.scanTime.toISOString()}, ` +
        `${leaving ? "just before" : "just after"} it. The gate missed an earlier crossing; this scan was almost certainly ${expected}.`,
    });
  }

  return out;
}
