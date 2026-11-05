import { NextResponse } from "next/server";
import { exportPersonData } from "@/actions/privacy.actions";
import { codeOf } from "@/lib/action-errors";

/**
 * One person's data export as an Excel file, for a data access request.
 *
 * <p>Built on the server action that carries the permission check and the
 * person's reach, as the report downloads are. Not allowed and not found both
 * answer 404, so a link does not confirm that a person exists. Each download
 * is written to the audit log by the action.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await exportPersonData({ employeeId: id });
  if (!res.success) {
    if (codeOf(res) === "UNAUTHENTICATED") return new NextResponse("Sign in to download this file.", { status: 401 });
    return new NextResponse("Employee not found", { status: 404 });
  }
  const { file, fileName } = res.data;
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
