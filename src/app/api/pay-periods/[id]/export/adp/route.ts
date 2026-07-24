import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import { format } from "date-fns";

// ADP EPI format — exact column order from the import spec
const HEADERS = [
  "Co Code", "Batch ID", "File #", "Shift",
  "Reg Hours", "O/T Hours",
  "Hours 3 Code", "Hours 3 Amount",
  "Hours 4 Code", "Hours 4 Amount",
  "Memo Code", "Memo Amount",
  "Reg Earnings", "O/T Earnings",
  "Earnings 3 Code", "Earnings 3 Amount",
  "Earnings 4 Code", "Earnings 4 Amount",
  "Earnings 5 Code", "Earnings 5 Amount",
  "Temp Dept", "Rate Code", "Temp Rate",
  "Adjust Ded Code", "Adjust Ded Amount",
  "Hours 3 Code", "Hours 3 Amount",
  "Hours 3 Code", "Hours 3 Amount",
  "Hours 3 Code", "Hours 3 Amount",
];

function esc(val: unknown): string {
  const s = val == null ? "" : String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// Strip trailing zeros after 2dp — matches ADP sample format
function toAdpHours(minutes: number): string {
  if (minutes === 0) return "";
  return parseFloat((minutes / 60).toFixed(2)).toString();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasPermission(session.user.role, "PAY_PERIOD_MANAGE")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const siteId   = sp.get("siteId")   ?? "";
  const status   = sp.get("status")   ?? "";
  const coCode   = sp.get("coCode")   || "ATW";
  const batchId  = sp.get("batchId")  || "BATCH1";

  const payPeriod = await db.payPeriod.findUnique({
    where: { id },
    select: { id: true, startDate: true, endDate: true, tenantId: true },
  });
  if (!payPeriod) return new NextResponse("Not found", { status: 404 });

  const tenantId = session.user.tenantId;
  if (tenantId && payPeriod.tenantId !== tenantId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const timesheets = await db.timesheet.findMany({
    where: {
      payPeriodId: id,
      ...(siteId   ? { employee: { siteId } }    : {}),
      ...(status   ? { status: status as never }  : {}),
    },
    include: {
      employee: { select: { adpWorkerId: true } },
      overtimeBuckets: true,
    },
    orderBy: { employee: { adpWorkerId: "asc" } },
  });

  const rows: string[][] = timesheets.map((ts) => {
    const reg = ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0;
    const ot  = ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes  ?? 0;

    // Build the 31-column ADP EPI row
    const row = new Array<string>(HEADERS.length).fill("");
    row[0]  = coCode;
    row[1]  = batchId;
    row[2]  = ts.employee.adpWorkerId ?? "";
    row[3]  = "";           // Shift — leave blank
    row[4]  = toAdpHours(reg);
    row[5]  = toAdpHours(ot);
    // columns 6–30 intentionally empty (no special codes mapped yet)
    return row;
  });

  const periodLabel = `${format(payPeriod.startDate, "yyyyMMdd")}_${format(payPeriod.endDate, "yyyyMMdd")}`;
  const filename = `EPI${coCode}01_${periodLabel}.csv`;

  const csv = [HEADERS, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
