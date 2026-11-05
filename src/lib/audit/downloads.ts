import type { AuditEntityType } from "@prisma/client";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import { writeAuditLog } from "@/lib/audit/logger";

/**
 * Records that someone took a file out of CloudTime: who, what and how much,
 * never the contents. Nothing said who exported pay or punch data (security
 * audit 2026-11, M6; September's M8).
 *
 * <p>Called after the permission check has passed and the file is made.
 * A failed write is logged and never stops the download.
 */
export type DownloadAction =
  | "REPORT_DOWNLOADED"
  | "PAY_PERIOD_EXPORTED"
  | "DOCUMENT_DOWNLOADED"
  | "LIVE_ATTENDANCE_EXPORTED";

export async function recordDownload(what: {
  action: DownloadAction;
  entityType: AuditEntityType;
  entityId: string;
  details: Record<string, string | number | boolean | null | undefined>;
}): Promise<void> {
  try {
    // Loaded here, not at the top: the routes that call this load without the
    // sign in library, as their tests expect.
    const [{ auth }, { cookies }] = await Promise.all([import("@/lib/auth"), import("next/headers")]);
    const session = await auth();
    if (!session?.user) return;
    let tenantId = session.user.tenantId ?? null;
    if (session.user.role === "SUPER_ADMIN") tenantId = (await cookies()).get(SUPER_ADMIN_TENANT_COOKIE)?.value ?? tenantId;
    await writeAuditLog({
      tenantId,
      actorId: session.user.employeeId ?? null,
      action: what.action,
      entityType: what.entityType,
      entityId: what.entityId,
      // A super admin has no employee record to name them, so their login does.
      changes: { after: { ...what.details, ...(session.user.employeeId ? {} : { superAdminLogin: session.user.id }) } },
    });
  } catch (err) {
    console.error("[download-log] not recorded:", err instanceof Error ? err.message : err);
  }
}
