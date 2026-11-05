import { NextResponse } from "next/server";
import { exportRetentionBatch } from "@/actions/privacy.actions";
import { codeOf } from "@/lib/action-errors";

/**
 * The retention review's download, as an Excel file: the leavers now due, or
 * their photos. Built on the server action that carries the permission check
 * and the caller's reach; the batch is worked out on the server, so the link
 * carries no ids. Every person in it is written to the audit log.
 */
export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind");
  const res = await exportRetentionBatch({ kind: kind === "photos" ? "photos" : "leavers" });
  if (!res.success) {
    if (codeOf(res) === "UNAUTHENTICATED") return new NextResponse("Sign in to download this file.", { status: 401 });
    return new NextResponse("Nothing to download", { status: 404 });
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
