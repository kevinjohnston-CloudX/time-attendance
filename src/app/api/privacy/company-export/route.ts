import { NextResponse } from "next/server";
import { startCompanyExport } from "@/actions/privacy.actions";
import { codeOf } from "@/lib/action-errors";
import { writeCompanyExport } from "@/lib/privacy/company-export";
import { ZipStream } from "@/lib/privacy/zip-stream";

/**
 * The whole company's data as one ZIP, streamed as it is read so it never
 * sits in memory. The action checks the permission and records the
 * download first; the company is always the caller's own. One export at a
 * time per company on each server, so a double click does not read the
 * database twice. Not allowed answers 404, as the other downloads do.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const running = new Set<string>();

export async function GET(req: Request) {
  const photos = new URL(req.url).searchParams.get("photos") === "1";
  const res = await startCompanyExport({ photos });
  if (!res.success) {
    if (codeOf(res) === "UNAUTHENTICATED") return new NextResponse("Sign in to download this file.", { status: 401 });
    return new NextResponse("Not found", { status: 404 });
  }
  const { tenantId, name } = res.data;
  if (running.has(tenantId)) return new NextResponse("An export of this company is already running. Wait for it to finish.", { status: 409 });
  running.add(tenantId);

  const exportedAt = new Date();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const zip = new ZipStream(async (chunk) => {
    await writer.ready;
    await writer.write(chunk);
  });

  void (async () => {
    try {
      await writeCompanyExport(tenantId, zip, { photos, exportedAt });
      await zip.finish();
      await writer.close();
    } catch (err) {
      // A cancelled download lands here too. The file is left incomplete,
      // which the browser reports as a failed download.
      console.error("[company export]", err instanceof Error ? err.message : err);
      await writer.abort(err).catch(() => {});
    } finally {
      running.delete(tenantId);
    }
  })();

  const fileName = `${name} CloudTime data ${exportedAt.toISOString().slice(0, 10)}.zip`.replace(/[^\p{L}\p{N} ._-]/gu, "").trim();
  return new Response(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
