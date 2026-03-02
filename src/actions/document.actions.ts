"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { hasPermission } from "@/lib/rbac/permissions";
import { writeAuditLog } from "@/lib/audit/logger";
import { uploadToStorage, deleteFromStorage } from "@/lib/supabase-storage";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import {
  uploadDocumentMetaSchema,
  deleteDocumentSchema,
  isAllowedMime,
  mimeToExt,
  MAX_FILE_SIZE_BYTES,
  type DeleteDocumentInput,
} from "@/lib/validators/document.schema";

// ─── uploadDocument ───────────────────────────────────────────────────────────
// Uses manual auth because withRBAC cannot handle File/FormData inputs.

export async function uploadDocument(
  formData: FormData
): Promise<{ success: true; data: { documentId: string } } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user) return { success: false, error: "UNAUTHENTICATED" };
    if (!hasPermission(session.user.role, "DOCUMENT_UPLOAD"))
      return { success: false, error: "FORBIDDEN" };

    // Resolve tenantId (with SUPER_ADMIN cookie override)
    let tenantId = session.user.tenantId ?? null;
    if (session.user.role === "SUPER_ADMIN") {
      const cookieStore = await cookies();
      const override = cookieStore.get(SUPER_ADMIN_TENANT_COOKIE)?.value;
      if (override) tenantId = override;
    }
    if (!tenantId) return { success: false, error: "No tenant context" };

    // Extract + validate metadata
    const rawEmployeeId = formData.get("employeeId");
    const rawTitle = formData.get("title");
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0)
      return { success: false, error: "No file provided" };

    const meta = uploadDocumentMetaSchema.safeParse({
      employeeId: rawEmployeeId,
      title: rawTitle,
    });
    if (!meta.success)
      return { success: false, error: meta.error.issues[0]?.message ?? "Invalid input" };

    const { employeeId, title } = meta.data;

    // Validate file type and size
    if (!isAllowedMime(file.type))
      return { success: false, error: "File type not allowed. Use PDF, JPG, PNG, DOC, or DOCX." };
    if (file.size > MAX_FILE_SIZE_BYTES)
      return { success: false, error: "File exceeds 10 MB limit." };

    // Tenant-scope guard: verify the employee belongs to this tenant
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { tenantId: true },
    });
    if (!employee) return { success: false, error: "Employee not found" };
    if (employee.tenantId !== tenantId) return { success: false, error: "FORBIDDEN" };

    // Build storage path and upload
    const ext = mimeToExt(file.type);
    const storagePath = `${tenantId}/${employeeId}/${randomUUID()}.${ext}`;

    await uploadToStorage(storagePath, file, file.type);

    // Write DB record — roll back storage file if this fails
    let doc: { id: string };
    try {
      const actorId = session.user.employeeId || undefined;
      doc = await db.document.create({
        data: {
          employeeId,
          title,
          fileUrl: storagePath,
          fileType: file.type,
          uploadedBy: actorId ?? "system",
        },
        select: { id: true },
      });

      await writeAuditLog({
        tenantId,
        actorId: actorId ?? null,
        action: "DOCUMENT_UPLOADED",
        entityType: "DOCUMENT",
        entityId: doc.id,
        changes: { after: { title, employeeId, fileType: file.type } },
      });
    } catch (dbErr) {
      // Orphan prevention: delete the uploaded file before re-throwing
      await deleteFromStorage(storagePath);
      throw dbErr;
    }

    revalidatePath("/documents");
    return { success: true, data: { documentId: doc.id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return { success: false, error: message };
  }
}

// ─── getMyDocuments ───────────────────────────────────────────────────────────

export const getMyDocuments = withRBAC(
  "DOCUMENT_VIEW_OWN",
  async ({ employeeId }, _input: void) => {
    return db.document.findMany({
      where: { employeeId },
      orderBy: { uploadedAt: "desc" },
    });
  }
);

// ─── getAllDocuments ───────────────────────────────────────────────────────────

export const getAllDocuments = withRBAC(
  "DOCUMENT_VIEW_ANY",
  async ({ tenantId }, _input: void) => {
    return db.document.findMany({
      where: {
        employee: { tenantId: tenantId ?? undefined },
      },
      include: {
        employee: {
          include: { user: { select: { name: true } } },
        },
      },
      orderBy: { uploadedAt: "desc" },
    });
  }
);

// ─── getEmployeesForDocumentUpload ────────────────────────────────────────────

export const getEmployeesForDocumentUpload = withRBAC(
  "DOCUMENT_UPLOAD",
  async ({ tenantId }, _input: void) => {
    return db.employee.findMany({
      where: { isActive: true, tenantId: tenantId ?? undefined },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    });
  }
);

// ─── deleteDocument ───────────────────────────────────────────────────────────

export const deleteDocument = withRBAC(
  "DOCUMENT_UPLOAD",
  async ({ employeeId: actorId, tenantId }, input: DeleteDocumentInput) => {
    const { documentId } = deleteDocumentSchema.parse(input);

    const doc = await db.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { employee: { select: { tenantId: true } } },
    });

    // Tenant-scope guard
    if (doc.employee.tenantId !== tenantId) throw new Error("FORBIDDEN");

    // Only the uploader may delete
    if (doc.uploadedBy !== actorId) throw new Error("Only the uploader can delete this document.");

    // DB delete first, then storage (orphaned file is lower risk than phantom DB record)
    await db.document.delete({ where: { id: documentId } });

    await writeAuditLog({
      tenantId,
      actorId,
      action: "DOCUMENT_DELETED",
      entityType: "DOCUMENT",
      entityId: documentId,
      changes: { before: { title: doc.title, employeeId: doc.employeeId } },
    });

    // Swallow storage errors — DB record is already gone
    await deleteFromStorage(doc.fileUrl);

    revalidatePath("/documents");
  }
);
