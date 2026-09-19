import { NextRequest, NextResponse } from "next/server";
import { findEmployeeIdentityByBadge } from "@/lib/utils/badge-lookup";
import { kioskScanSchema } from "@/lib/validators/punch.schema";
import { parseScanTime } from "@/lib/utils/scan-time";
import { normaliseLegacyScanType, recordScanEvent } from "@/lib/services/scan-event.service";

/**
 * Security-gate scan ingest.
 *
 * Records a gate scan in `scan_events` and answers with the direction the
 * kiosk should display. This is the only place the gate's IN/OUT is decided
 * for display purposes.
 *
 * <b>What this endpoint deliberately does not do:</b> it never creates a
 * Punch, a timesheet or a work segment. A gate scan is a building-access
 * event, not paid time — routing it into the punch pipeline would double-count
 * hours for anyone who badges through a gate and then clocks in.
 *
 * Time Clock punches do not come here. They keep going to
 * /api/timeclock/punch, which still owns the punch pipeline and now writes a
 * linked scan_events row alongside it, so both streams land in one table
 * without this route duplicating any payroll logic.
 */

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  // 1. Same shared secret the punch endpoint uses.
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.TIMECLOCK_API_KEY;
  if (!expectedKey || !apiKey || apiKey !== expectedKey) {
    return unauthorized();
  }

  // 2. Parse and validate.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = kioskScanSchema.safeParse(body);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => i.message).join("; ");
    return NextResponse.json({ success: false, error: msgs }, { status: 400 });
  }

  const { EmployeeCode, ScanDateTime, Stream, DeviceName, Warehouse, LegacyScanType } = parsed.data;

  if (Stream !== "SECURITY") {
    return NextResponse.json(
      {
        success: false,
        error: "Time Clock punches must be sent to /api/timeclock/punch, which records both tables.",
      },
      { status: 400 },
    );
  }

  // 3. Resolve the timezone this scan should be read in.
  //    The gate sends its own UTC offset, so this is only a fallback — but a
  //    scan from a badge we cannot match still has to be stored, and storing
  //    it at the wrong instant would be worse than not storing it at all.
  const employee = await findEmployeeIdentityByBadge(EmployeeCode);

  let scanTime: Date;
  try {
    scanTime = parseScanTime(ScanDateTime, employee?.site.timezone ?? "America/New_York");
  } catch {
    return NextResponse.json(
      { success: false, error: `Invalid ScanDateTime: ${ScanDateTime}` },
      { status: 400 },
    );
  }

  // 4. Record. Unmatched badges are stored too, with UNKNOWN direction —
  //    those are exactly the scans someone asks about afterwards.
  try {
    const result = await recordScanEvent({
      badgeCode: EmployeeCode,
      stream: "SECURITY",
      scanTime,
      deviceName: DeviceName ?? null,
      site: Warehouse == null ? null : String(Warehouse),
      legacyScanType: LegacyScanType ?? null,
      // The direction Oracle just stated for this very scan, used as fact
      // rather than re-derived.
      //
      // The gate has no daily re-anchor — deliberately, because night shift
      // crosses midnight — so alternation there has no point at which it can
      // re-sync. One crossing the table never saw inverts every scan after it
      // for that badge, indefinitely. That is not hypothetical: after the
      // 2026-09-18 mid-day rollout, 87 of 129 badges came out the exact
      // inverse of Oracle end to end, because the first crossing each tablet
      // witnessed was people leaving at lunch rather than arriving.
      //
      // Not to be confused with the SCANTYPE *column* of the legacy report,
      // which backfill-scan-events.ts refuses for good reason: there it is the
      // visit row's state ("have they left yet"), not the direction of an
      // event. The live PUT response is a different thing — Oracle's verdict on
      // the scan just recorded — and it behaves like one, alternating across
      // 96.1% of consecutive scans per badge where a state flag could not.
      //
      // Null when the legacy call never answered, which is the offline queue's
      // case: those fall through to alternation exactly as before.
      knownDirection: normaliseLegacyScanType(LegacyScanType) ?? undefined,
      // A gate crossing never enters the timecard pipeline, so it is resolved
      // the moment it is stored. Leaving these PENDING would have the
      // discrepancy sweep chase a punch that was never meant to exist.
      outcome: "NOT_APPLICABLE",
    });

    return NextResponse.json({
      success: true,
      scanId: result.id,
      direction: result.direction,
      employeeName: result.employeeName,
      employeeMatched: result.employeeId !== null,
      duplicate: result.duplicate,
      legacyMismatch: result.legacyMismatch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
