"use server";

import { withRBAC } from "@/lib/rbac/guard";
import { assertRecordInReach, NotFoundError } from "@/lib/rbac/scope";
import { writeAuditLog } from "@/lib/audit/logger";
import { photoUrls } from "@/lib/presence/photos";
import { db } from "@/lib/db";
import { buildPersonWorkbook, collectPersonData, type PersonExport } from "@/lib/privacy/person-export";
import { companyDataProtection, type DataProtection } from "@/lib/privacy/data-protection";
import { planAnonymise, runAnonymise } from "@/lib/privacy/anonymise";
import { assertNotSenior } from "@/lib/rbac/scope";
import { checkPermission } from "@/lib/rbac/check-permission";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

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

// ─── Company data protection settings (EU companies) ─────────────────────────

/** The company's data protection settings, for Company Settings. */
export const getDataProtection = withRBAC("EMPLOYEE_MANAGE", async (ctx, _input: void) => {
  return companyDataProtection(ctx.tenantId);
});

/**
 * Switches one data protection setting for the caller's company. Who: the
 * people who manage employee records (HR Admins, System Admins), since these
 * decide what employee records may hold. Written to the audit log.
 */
export const updateDataProtection = withRBAC(
  "EMPLOYEE_MANAGE",
  async (ctx, input: { noMedicalNotes?: boolean; anonymise?: Partial<DataProtection["anonymise"]> }) => {
    if (!ctx.tenantId) throw new NotFoundError("This company isn't available to you.");
    const before = await companyDataProtection(ctx.tenantId);
    const a = input?.anonymise ?? {};
    for (const k of ["enabled", "deletePhoto", "deleteDocuments"] as const) {
      if (a[k] !== undefined && typeof a[k] !== "boolean") throw new Error("Choose on or off.");
    }
    if (input?.noMedicalNotes !== undefined && typeof input.noMedicalNotes !== "boolean") throw new Error("Choose on or off.");
    if (a.history !== undefined && a.history !== "REPLACE" && a.history !== "KEEP") throw new Error("Choose how the change history is handled.");
    const after: DataProtection = {
      noMedicalNotes: input?.noMedicalNotes ?? before.noMedicalNotes,
      anonymise: { ...before.anonymise, ...a },
    };
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { dataProtection: after as unknown as Prisma.InputJsonValue } });
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.employeeId,
      action: "SETTINGS_UPDATE",
      // Company settings are filed under pay periods with the company as the
      // record, as updateTenantSettings does: the log has no company type.
      entityType: "PAY_PERIOD",
      entityId: ctx.tenantId,
      changes: { before: { dataProtection: before }, after: { dataProtection: after } },
    });
    revalidatePath("/admin/settings");
    return after;
  }
);

// ─── Anonymise a person who has left (EU companies) ──────────────────────────

/**
 * Who may anonymise: someone who manages employee records (EMPLOYEE_MANAGE)
 * and may export a person's data (EMPLOYEE_DATA_EXPORT), since the export is
 * the only copy kept. Whose: one person in reach, as opening the record, never
 * the caller and never someone ranked above them. Only in a company that has
 * switched it on, and only for someone who has left.
 */
async function anonymiseContext(ctx: { employeeId: string; tenantId: string | null; role: string }, employeeId: string) {
  if (!ctx.tenantId) throw new NotFoundError("This employee isn't available to you.");
  if (!(await checkPermission("EMPLOYEE_DATA_EXPORT"))) throw new Error("You need permission to export employee data to anonymise someone.");
  await assertRecordInReach(ctx, employeeId);
  await assertNotSenior(ctx as Parameters<typeof assertNotSenior>[0], employeeId);
  const settings = await companyDataProtection(ctx.tenantId);
  return { tenantId: ctx.tenantId, settings };
}

/** What anonymising would do, read only, for the window. */
export const getAnonymisePreview = withRBAC(
  "EMPLOYEE_MANAGE",
  async (ctx, input: { employeeId: string }) => {
    const { tenantId, settings } = await anonymiseContext(ctx, input.employeeId);
    const emp = await db.employee.findFirst({ where: { id: input.employeeId, tenantId }, select: { id: true, barcode: true, wmsId: true, employeeCode: true } });
    const photo = emp ? (await photoUrls(tenantId, [emp])).get(emp.id) : null;
    const plan = await planAnonymise(tenantId, input.employeeId, settings, ctx.employeeId, !!photo);
    if (!plan) throw new NotFoundError("This employee isn't available to you.");
    return { ...plan, exportedAt: plan.exportedAt?.toISOString() ?? null, settings: settings.anonymise };
  }
);

/**
 * Anonymises the person. Every check of the preview is made again here, and
 * the employee code must be typed exactly, so nothing runs by accident.
 */
export const anonymiseEmployee = withRBAC(
  "EMPLOYEE_MANAGE",
  async (ctx, input: { employeeId: string; confirmCode: string }) => {
    const { tenantId, settings } = await anonymiseContext(ctx, input.employeeId);
    const plan = await planAnonymise(tenantId, input.employeeId, settings, ctx.employeeId, false);
    if (!plan) throw new NotFoundError("This employee isn't available to you.");
    if (plan.blockers.length) throw new Error(plan.blockers[0]);
    if ((input.confirmCode ?? "").trim() !== plan.employeeCode) throw new Error(`Type the employee code ${plan.employeeCode} to confirm.`);

    const result = await runAnonymise(tenantId, input.employeeId, settings);
    if (!result) throw new NotFoundError("This employee isn't available to you.");

    // Counts only: the entry must not keep what was just removed.
    await writeAuditLog({
      tenantId,
      actorId: ctx.employeeId,
      action: "PERSONAL_DATA_ANONYMISED",
      entityType: "EMPLOYEE",
      entityId: input.employeeId,
      changes: { after: { ...result, settings: settings.anonymise } },
    });
    revalidatePath(`/admin/employees/${input.employeeId}`);
    revalidatePath("/admin/employees");
    return result;
  }
);
