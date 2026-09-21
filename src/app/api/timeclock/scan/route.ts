import { NextRequest, NextResponse } from "next/server";
import { findEmployeeIdentityByBadge } from "@/lib/utils/badge-lookup";
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
      // Oracle's verdict is recorded, and compared against, but no longer
      // decides. `legacyMismatch` is therefore a working watchdog again.
      legacyScanType: LegacyScanType ?? null,
      //
      // WHY NOT `knownDirection` ANY MORE (this reverses 4c7a4db, 2026-09-19).
      //
      // That commit made Oracle authoritative because CloudTime's alternation
      // had no re-anchor on this stream: after the 2026-09-18 mid-day rollout
      // 87 of 129 badges came out the exact inverse, since the first crossing
      // each tablet witnessed was people leaving at lunch. With nothing to
      // re-sync against, one missed crossing inverted a badge indefinitely.
      // Deferring to Oracle was right then. It is wrong now, and what changed
      // is that both holes have since been filled:
      //
      //   - `/api/cron/auto-close-scans` closes anyone still showing IN at
      //     23:00 local, so the gate re-anchors nightly. A phase error now
      //     lasts one day instead of forever, and every first scan of a
      //     morning resolves to IN by construction.
      //   - the REREAD rule stops a badge read twice inside a minute from
      //     flipping anything, which was the main source of drift.
      //
      // Oracle has neither. Its rule is "if your last row says IN, close it
      // and call this OUT", and nothing ever resets timestationscanlog — no
      // sweep, no scheduler in that service at all — so a double-read leaves
      // it holding a phantom open row until the person's next badge, however
      // many days later.
      //
      // Measured on NJ299 for 2026-09-20 by replaying all 145 gate scans
      // through both schemes: they differ on 43, and **14 of 56 people had
      // Oracle call their FIRST scan of the day an OUT** — it told fourteen
      // people arriving in the morning that they were leaving. At a site with
      // no overnight shifts a first badge cannot be a departure, so those are
      // not judgement calls, they are Oracle being wrong and CloudTime being
      // right. See [[project-nj299-shift-and-oracle-limits]].
      //
      // The trade, stated plainly: a gate post that fails and never retries
      // now drifts that badge until 23:00, where deferring to Oracle would
      // have caught it. Bounded to one day, and accepted deliberately — the
      // legacy system is being retired, so CloudTime has to be able to answer
      // this on its own eventually, and the anchors that make that safe exist
      // now rather than being promised.
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
      // The badge was read again within the re-read window, so `direction` is
      // the one already showing rather than a new crossing. A kiosk that
      // understands this field should say so instead of announcing a crossing
      // that did not happen; one that ignores it still gets a direction that no
      // longer flips, which is the half that matters for the record.
      reread: result.reread,
      legacyMismatch: result.legacyMismatch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
