import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { kioskScanSchema } from "@/lib/validators/punch.schema";
import { parseScanTime } from "@/lib/utils/scan-time";
import { recordScanEvent } from "@/lib/services/scan-event.service";

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
  const employee = await db.employee.findUnique({
    where: { wmsId: EmployeeCode },
    select: { site: { select: { timezone: true } } },
  });

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
      warehouse: Warehouse ?? null,
      legacyScanType: LegacyScanType ?? null,
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
