import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { hasIdentity, readReport } from "@/lib/devices/check-in";
import { recordCheckIn } from "@/lib/devices/device.service";

/**
 * A tablet saying how it is: identity, build, setup, battery, network, queue,
 * storage and health, every five minutes (build 163 and later). See
 * src/lib/devices/check-in.ts for how a check-in is read and matched to its
 * tablet, and the Android repo's docs/device-telemetry-contract.md for the body.
 *
 * <p><b>It never fails the tablet</b>, as legacy-sync does not: a check-in that
 * cannot be stored is a reporting problem, and the tablet's answer to any error
 * is only to ask again later. So anything unexpected is answered 200 with
 * `stored: false`; the one exception is a bad API key, which is worth knowing.
 *
 * <p><b>Always JSON.</b> The tablet reads a 404, or a 2xx that is not JSON, as
 * "this route is not deployed" and backs off to one try an hour. Every answer
 * here is JSON so a deployed route is never mistaken for a missing one.
 *
 * <p>The answer's `commands` (housekeeping the tablet should do) is always
 * empty for now; sending commands is the next step, and the tablet already
 * knows how to run them.
 */

export const dynamic = "force-dynamic";

/** A check-in is about 2 KB. Anything far past that is not one. */
const MAX_BODY_BYTES = 64 * 1024;

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

function notStored(error: string) {
  return NextResponse.json({ success: true, stored: false, error, commands: [] });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.TIMECLOCK_API_KEY;
  if (!expectedKey || !apiKey || apiKey !== expectedKey) {
    return unauthorized();
  }

  const receivedAt = new Date();
  let text: string;
  try {
    text = await req.text();
  } catch {
    return notStored("Unreadable body");
  }
  if (text.length > MAX_BODY_BYTES) {
    return notStored("Body too large");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return notStored("Invalid JSON body");
  }

  const report = readReport(body);
  if (!hasIdentity(report)) {
    return notStored("No device identity");
  }

  try {
    const result = await recordCheckIn(report, body as Prisma.InputJsonValue, receivedAt);
    // Only the events worth reading in the server log; a routine check-in says nothing.
    if (result.created || result.installChanged || result.tagInUse) {
      console.info("device-checkin", {
        device: result.deviceId,
        name: report.deviceName,
        created: result.created || undefined,
        newInstall: result.installChanged || undefined,
        matchedBy: result.matchedBy,
        assetTagInUse: result.tagInUse || undefined,
      });
    }
    return NextResponse.json({ success: true, stored: true, deviceId: result.deviceId, commands: [] });
  } catch (err) {
    console.error("device-checkin: could not store", { name: report.deviceName, installId: report.installId }, err);
    return notStored("Could not store the check-in");
  }
}
