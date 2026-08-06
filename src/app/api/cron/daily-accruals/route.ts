import { NextRequest, NextResponse } from "next/server";
import { runDailyAccruals } from "@/lib/engines/accrual-engine";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const result = await runDailyAccruals();
  return NextResponse.json({ ok: true, ...result });
}

/**
 * POST accepts an optional { date: "YYYY-MM-DD" } body to backfill a specific date.
 * Useful for manual catch-up runs if the cron was missed.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { date?: string };
  const runDate = body.date ? new Date(`${body.date}T00:00:00Z`) : undefined;

  const result = await runDailyAccruals(runDate);
  return NextResponse.json({ ok: true, ...result });
}
