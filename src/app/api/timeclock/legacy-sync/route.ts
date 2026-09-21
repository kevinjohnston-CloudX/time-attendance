import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findEmployeeIdentityByBadge } from "@/lib/utils/badge-lookup";
import { legacySyncReportSchema } from "@/lib/validators/punch.schema";
import { parseScanTime } from "@/lib/utils/scan-time";

/**
 * What happened when a tablet talked to Oracle.
 *
 * <p><b>Why a tablet has to tell us this.</b> CloudTime cannot reach Oracle —
 * the bridge talks to a read-only standby — so the only thing that writes a
 * punch there is the tablet, and the only record of whether it worked was a
 * SQLite row on that device. That was survivable while Oracle answered in front
 * of the employee: a refusal was visible because somebody was standing there.
 *
 * <p>It stopped being survivable when the time clock started deciding in
 * CloudTime and writing to Oracle behind the employee. A refusal now lands on a
 * queue row nobody is watching, and the first anybody hears of it is a shift
 * missing from a timecard. This endpoint is where that becomes answerable.
 *
 * <p><b>It never fails the tablet.</b> A report that cannot be stored is a
 * reporting problem, and a reporting problem must not make a kiosk retry, stall
 * or drop a punch. Anything unexpected is answered 200 with `stored: false` —
 * the one exception being a bad API key, which is worth knowing about.
 */

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.TIMECLOCK_API_KEY;
  if (!expectedKey || !apiKey || apiKey !== expectedKey) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: true, stored: false, error: "Invalid JSON body" });
  }

  const parsed = legacySyncReportSchema.safeParse(body);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => i.message).join("; ");
    return NextResponse.json({ success: true, stored: false, error: msgs });
  }

  const {
    EmployeeCode,
    Kind,
    Outcome,
    ScanDateTime,
    Endpoint,
    Message,
    AttemptCount,
    QueueRowId,
    DeviceName,
    AppVersion,
  } = parsed.data;

  try {
    // Resolved where possible, but never required. A badge CloudTime does not
    // know is exactly the kind of report worth keeping — it means a tablet is
    // writing punches to Oracle for somebody this system cannot name.
    const employee = await findEmployeeIdentityByBadge(EmployeeCode);

    // The site's zone, because the tablet stamps local time with no offset.
    // Falling back to Eastern is what every other ingest path here does.
    let scanTime: Date;
    try {
      scanTime = parseScanTime(ScanDateTime, employee?.site.timezone ?? "America/New_York");
    } catch {
      return NextResponse.json({
        success: true,
        stored: false,
        error: `Invalid ScanDateTime: ${ScanDateTime}`,
      });
    }

    const data = {
      badgeCode: EmployeeCode,
      kind: Kind,
      outcome: Outcome,
      scanTime,
      endpoint: Endpoint ?? null,
      message: Message ?? null,
      attemptCount: AttemptCount ?? 1,
      queueRowId: QueueRowId ?? null,
      deviceName: DeviceName ?? null,
      appVersion: AppVersion ?? null,
      employeeId: employee?.id ?? null,
    };

    // A tablet re-sends a report it is not sure landed. The same attempt on the
    // same queue row is the same event, so it updates rather than duplicating —
    // otherwise a flaky uplink would inflate exactly the counts somebody is
    // about to make a decision from.
    const row =
      DeviceName && QueueRowId != null
        ? await db.legacySyncLog.upsert({
            where: {
              deviceName_queueRowId_attemptCount: {
                deviceName: DeviceName,
                queueRowId: QueueRowId,
                attemptCount: data.attemptCount,
              },
            },
            update: data,
            create: data,
          })
        : await db.legacySyncLog.create({ data });

    return NextResponse.json({ success: true, stored: true, id: row.id });
  } catch (err) {
    console.error("legacy-sync: failed to record report for badge", EmployeeCode, err);
    return NextResponse.json({ success: true, stored: false });
  }
}
