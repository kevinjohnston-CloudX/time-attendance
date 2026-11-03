"use server";

import { withRBAC } from "@/lib/rbac/guard";
import { assertRecordInReach, NotFoundError } from "@/lib/rbac/scope";
import { writeAuditLog } from "@/lib/audit/logger";
import { photoUrls } from "@/lib/presence/photos";
import { db } from "@/lib/db";
import { buildPersonWorkbook, collectPersonData, type PersonExport } from "@/lib/privacy/person-export";

/**
 * A person's data export, for a data access request.
 *
 * <p>Who: EMPLOYEE_DATA_EXPORT, which HR Admins and System Admins have and a
 * custom role gets from Employees, Execute. Whose: one person in the caller's
 * company and, for an admin held to some sites, at one of those sites, the
 * same reach as opening the record. Anyone else answers not found.
 *
 * <p>Every download is written to the audit log, so the record shows who took
 * a copy of the person's data and when. Looking at the counts is not.
 */

async function inReach(ctx: { employeeId: string; tenantId: string | null; role: string }, employeeId: string) {
  if (!ctx.tenantId) throw new NotFoundError("This employee isn't available to you.");
  await assertRecordInReach(ctx, employeeId);
  const data = await collectPersonData(ctx.tenantId, employeeId);
  if (!data) throw new NotFoundError("This employee isn't available to you.");
  return { tenantId: ctx.tenantId, data };
}

/** What the export holds, sheet by sheet, for the window. No personal data. */
export const getPersonDataSummary = withRBAC(
  "EMPLOYEE_DATA_EXPORT",
  async (ctx, input: { employeeId: string }) => {
    const { data } = await inReach(ctx, input.employeeId);
    return data.sections.map((s) => ({ title: s.title, description: s.description, count: s.rows.length }));
  }
);

/** The photo's bytes, fetched through the same signed link the record page shows. */
async function photoFor(tenantId: string, employeeId: string): Promise<PersonExport["photo"]> {
  const emp = await db.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { id: true, barcode: true, wmsId: true, employeeCode: true },
  });
  if (!emp) return null;
  const url = (await photoUrls(tenantId, [emp])).get(emp.id);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    const extension = type.includes("png") ? "png" : "jpeg";
    return { bytes: Buffer.from(await res.arrayBuffer()), extension };
  } catch {
    // The photo store being slow or away leaves the photo out, not the export.
    return null;
  }
}

/** The workbook itself. Called by the download route only. */
export const exportPersonData = withRBAC(
  "EMPLOYEE_DATA_EXPORT",
  async (ctx, input: { employeeId: string }) => {
    const { tenantId, data } = await inReach(ctx, input.employeeId);
    const photo = await photoFor(tenantId, input.employeeId);
    const exportedAt = new Date();
    const file = await buildPersonWorkbook({ ...data, photo }, exportedAt);

    await writeAuditLog({
      tenantId,
      actorId: ctx.employeeId,
      action: "PERSONAL_DATA_EXPORTED",
      entityType: "EMPLOYEE",
      entityId: input.employeeId,
      changes: {
        after: {
          sheets: Object.fromEntries(data.sections.map((s) => [s.title, s.rows.length])),
          photo: photo != null,
        },
      },
    });

    const stem = `${data.name} personal data ${exportedAt.toISOString().slice(0, 10)}`.replace(/[^\p{L}\p{N} ._-]/gu, "").trim();
    return { file, fileName: `${stem}.xlsx` };
  }
);
