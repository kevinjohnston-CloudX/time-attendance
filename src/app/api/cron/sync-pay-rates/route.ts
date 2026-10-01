import { NextRequest, NextResponse } from "next/server";
import { syncCurrentPayRates } from "@/lib/pay-rates";

/** Nightly: a pay rate dated for today becomes the employee's current rate. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const changed = await syncCurrentPayRates();
  return NextResponse.json({ ok: true, changed });
}
