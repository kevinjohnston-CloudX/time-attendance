import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { syncCurrentPayRates } from "@/lib/pay-rates";

/** Nightly: a pay rate dated for today becomes the employee's current rate. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const changed = await syncCurrentPayRates();
  return NextResponse.json({ ok: true, changed });
}
