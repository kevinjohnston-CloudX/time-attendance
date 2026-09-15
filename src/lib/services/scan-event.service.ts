import { db } from "@/lib/db";
import type { Prisma, ScanDirection, ScanStream } from "@prisma/client";

/**
 * Recording and direction-resolution for {@link ScanEvent} — the single table
 * that holds every kiosk badge scan, Security gate and Time Clock alike.
 *
 * The one rule this file exists to enforce: a direction is either derived from
 * something authoritative or it is UNKNOWN. Nothing here guesses. A scan shown
 * to an employee as the wrong direction is a payroll dispute; a scan shown with
 * no direction is a shrug.
 */

/** What a caller needs to render a result screen and nothing more. */
export type RecordedScan = {
  id: string;
  direction: ScanDirection;
  stream: ScanStream;
  scanTime: Date;
  employeeId: string | null;
  employeeName: string | null;
  /** True when this exact scan was already stored — a retry, not a new event. */
  duplicate: boolean;
  /** Set when the legacy API's ScanType disagreed with what we resolved. */
  legacyMismatch: boolean;
};

export type RecordScanInput = {
  badgeCode: string;
  stream: ScanStream;
  scanTime: Date;
  deviceName?: string | null;
  warehouse?: number | null;
  /** Supplied for TIME_CLOCK, where the punch pipeline owns the direction. */
  punchId?: string | null;
  direction?: ScanDirection;
  /** What cajaapi said, recorded for reconciliation only. */
  legacyScanType?: string | null;
  note?: string | null;
};

/**
 * The gate alternates: every scan is the opposite of that employee's previous
 * one. Resolved against the previous event *by scan time* rather than by
 * arrival, because an offline tablet flushes its queue out of order — a scan
 * from 06:02 can land after one from 06:47.
 *
 * With no previous event the answer is IN. That is the only safe default at a
 * gate: the first scan of someone's day is an arrival, and treating an unknown
 * first scan as an exit would immediately desynchronise the whole stream.
 */
async function resolveSecurityDirection(
  tx: Prisma.TransactionClient,
  employeeId: string,
  scanTime: Date,
  excludeId?: string,
): Promise<ScanDirection> {
  const previous = await tx.scanEvent.findFirst({
    where: {
      employeeId,
      stream: "SECURITY",
      scanTime: { lt: scanTime },
      direction: { in: ["IN", "OUT"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
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
 * Without this, a queued scan that arrives late leaves every SECURITY event
 * after it holding the direction it was given before the gap was filled — so a
 * tablet coming back online would silently invert an employee's whole day. Runs
 * only for SECURITY (the Time Clock stream takes its direction from the punch
 * engine) and only over events after the inserted one.
 */
async function reresolveFollowingSecurityEvents(
  tx: Prisma.TransactionClient,
  employeeId: string,
  afterScanTime: Date,
  startingFrom: ScanDirection,
): Promise<number> {
  const following = await tx.scanEvent.findMany({
    where: {
      employeeId,
      stream: "SECURITY",
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
 * Stores one scan and returns the direction to display.
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
    select: {
      id: true,
      tenantId: true,
      isActive: true,
      user: { select: { name: true } },
    },
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
    select: { id: true, direction: true, legacyMismatch: true },
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
      legacyMismatch: existing.legacyMismatch,
    };
  }

  const created = await db.$transaction(async (tx) => {
    let direction: ScanDirection;

    if (!employee) {
      // Nothing to key a stream on, so nothing honest to say about direction.
      direction = "UNKNOWN";
    } else if (input.stream === "TIME_CLOCK") {
      // The punch state machine already decided; we only mirror it.
      direction = input.direction ?? "UNKNOWN";
    } else {
      direction = await resolveSecurityDirection(tx, employee.id, input.scanTime);
    }

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
        punchId: input.punchId ?? null,
        legacyScanType: legacy,
        legacyMismatch,
        note: input.note ?? (employee ? null : "no employee matches this badge"),
      },
      select: { id: true, direction: true, legacyMismatch: true },
    });

    // Only the gate alternates, so only the gate can be knocked out of step.
    if (employee && input.stream === "SECURITY" && direction !== "UNKNOWN") {
      await reresolveFollowingSecurityEvents(
        tx,
        employee.id,
        input.scanTime,
        direction,
      );
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
    legacyMismatch: created.legacyMismatch,
  };
}

/** Accepts the legacy API's "IN" / "OUT" in any casing; anything else is dropped. */
function normaliseLegacyScanType(value?: string | null): ScanDirection | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return upper === "IN" || upper === "OUT" ? upper : null;
}

/**
 * Where this employee currently stands in each stream, independently.
 *
 * Returns both because they answer different questions — SECURITY is "are they
 * in the building", TIME_CLOCK is "are they on the clock" — and a single
 * combined flag would be wrong for anyone on an unpaid meal.
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

/**
 * Everyone currently showing as present at the gate, most recent scan first.
 * Backs a "who is on site" view and the reconciliation an outage leaves behind.
 */
export async function getEmployeesOnSite(tenantId: string) {
  const latestPerEmployee = await db.$queryRaw<
    Array<{ employeeId: string; scanTime: Date; direction: ScanDirection }>
  >`
    SELECT DISTINCT ON ("employeeId")
           "employeeId", "scanTime", "direction"
    FROM   "scan_events"
    WHERE  "tenantId" = ${tenantId}
      AND  "stream" = 'SECURITY'
      AND  "employeeId" IS NOT NULL
      AND  "direction" IN ('IN', 'OUT')
    ORDER  BY "employeeId", "scanTime" DESC
  `;

  return latestPerEmployee.filter((row) => row.direction === "IN");
}

/**
 * Scans where the legacy API and this table disagreed. Expected to be empty —
 * a non-empty result means the two systems have drifted and the gate screens
 * are showing something Oracle does not agree with.
 */
export async function getLegacyMismatches(tenantId: string, since: Date) {
  return db.scanEvent.findMany({
    where: { tenantId, legacyMismatch: true, scanTime: { gte: since } },
    orderBy: { scanTime: "desc" },
    include: {
      employee: { select: { employeeCode: true, user: { select: { name: true } } } },
    },
  });
}
