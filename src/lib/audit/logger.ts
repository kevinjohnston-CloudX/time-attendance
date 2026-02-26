import { db } from "@/lib/db";
import { Prisma, type AuditEntityType } from "@prisma/client";

interface AuditParams {
  actorId?: string; // employeeId; omit for system actions
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  changes?: { before?: unknown; after?: unknown };
  ipAddress?: string;
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: params.actorId,
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
