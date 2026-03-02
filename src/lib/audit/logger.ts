import { db } from "@/lib/db";
import { Prisma, type AuditEntityType } from "@prisma/client";

interface AuditParams {
  tenantId?: string | null;
  actorId?: string | null; // employeeId; null/omit for system or super-admin actions
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  changes?: { before?: unknown; after?: unknown } | null;
  ipAddress?: string;
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: params.tenantId ?? undefined,
      actorId: params.actorId ?? undefined,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      changes: params.changes
        ? (params.changes as Prisma.InputJsonValue)
        : undefined,
      ipAddress: params.ipAddress,
    },
  });
}
