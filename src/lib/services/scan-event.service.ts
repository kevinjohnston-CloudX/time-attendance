import { db } from "@/lib/db";
import type { Prisma, ScanDirection, ScanOutcome, ScanStream } from "@prisma/client";

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
  warehouse?: number | null;
  /** Gate scans never enter the timecard pipeline, so they start resolved. */
  outcome?: ScanOutcome;
  /** What cajaapi said, recorded for reconciliation only. */
  legacyScanType?: string | null;
  note?: string | null;
};

/**
 * Alternates from the employee's previous scan in the same stream.
 *
 * Resolved against the previous event *by scan time* rather than by arrival,
 * because an offline tablet flushes its queue out of order — a scan from 06:02
 * can land after one from 06:47.
 *
 * With no previous event the answer is IN: the first scan of someone's day is
 * an arrival, and treating an unknown first scan as an exit would immediately
 * desynchronise the stream. That first scan after go-live is the one case
 * where this can legitimately disagree with an older system, which is why
 * `legacyMismatch` exists to mark it.
 *
 * For TIME_CLOCK this alternation also lines up with a four-punch day —
 * in, meal-start, meal-end, out reads as IN, OUT, IN, OUT — so it stays
 * comparable against the pipeline's own classification without borrowing it.
 */
async function resolveDirection(
  tx: Prisma.TransactionClient,
  employeeId: string,
  stream: ScanStream,
  scanTime: Date,
): Promise<ScanDirection> {
  const previous = await tx.scanEvent.findFirst({
    where: {
      employeeId,
      stream,
      scanTime: { lt: scanTime },
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
): Promise<number> {
  const following = await tx.scanEvent.findMany({
    where: {
      employeeId,
      stream,
      scanTime: { gt: afterScanTime },
      direction: { in: ["IN", "OUT"] },
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
  const employee = await db.employee.findUnique({
    where: { wmsId: input.badgeCode },
    select: { id: true, tenantId: true, user: { select: { name: true } } },
  });

  const employeeName = employee?.user?.name?.trim() || null;

  const existing = await db.scanEvent.findUnique({
    where: {
      badgeCode_stream_scanTime: {
        badgeCode: input.badgeCode,
        stream: input.stream,
        scanTime: input.scanTime,
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
      outcome: existing.outcome,
      punchId: existing.punchId,
      timecardPunchType: existing.timecardPunchType,
      timecardStateAfter: existing.timecardStateAfter,
      legacyMismatch: existing.legacyMismatch,
    };
  }

  const created = await db.$transaction(async (tx) => {
    // No employee means no stream to alternate within, and nothing honest to
    // say about direction.
    const direction: ScanDirection = employee
      ? await resolveDirection(tx, employee.id, input.stream, input.scanTime)
      : "UNKNOWN";

    const legacy = normaliseLegacyScanType(input.legacyScanType);
    const legacyMismatch =
      legacy !== null && direction !== "UNKNOWN" && legacy !== direction;

    const event = await tx.scanEvent.create({
      data: {
        tenantId: employee?.tenantId ?? null,
        employeeId: employee?.id ?? null,
        badgeCode: input.badgeCode,
        stream: input.stream,
        direction,
        scanTime: input.scanTime,
        deviceName: input.deviceName ?? null,
        warehouse: input.warehouse ?? null,
        outcome: input.outcome ?? (employee ? "PENDING" : "NO_EMPLOYEE"),
        legacyScanType: legacy,
        legacyMismatch,
        note: input.note ?? (employee ? null : "no employee matches this badge"),
      },
      select: { id: true, direction: true, legacyMismatch: true, outcome: true },
    });

    if (employee && direction !== "UNKNOWN") {
      await reresolveFollowing(tx, employee.id, input.stream, input.scanTime, direction);
    }

    return event;
  });

  return {
    id: created.id,
    direction: created.direction,
    stream: input.stream,
    scanTime: input.scanTime,
    employeeId: employee?.id ?? null,
    employeeName,
    duplicate: false,
    outcome: created.outcome,
    punchId: null,
    timecardPunchType: null,
    timecardStateAfter: null,
    legacyMismatch: created.legacyMismatch,
  };
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

/** Accepts the legacy API's "IN" / "OUT" in any casing; anything else is dropped. */
function normaliseLegacyScanType(value?: string | null): ScanDirection | null {
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
  | "DIRECTION_MISMATCH";

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
 * Only TIME_CLOCK scans are compared. Gate scans are excluded by design — they
 * never produce a punch, so "no punch" is their normal state and flagging them
 * would bury the real findings under thousands of expected rows.
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

  return out;
}
