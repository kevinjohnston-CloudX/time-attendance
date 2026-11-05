"use server";

import { withRBAC } from "@/lib/rbac/guard";
import { assertRecordInReach, NotFoundError, siteLimit } from "@/lib/rbac/scope";
import { writeAuditLog } from "@/lib/audit/logger";
import { photoUrls } from "@/lib/presence/photos";
import { db } from "@/lib/db";
import { buildPeopleWorkbook, buildPersonWorkbook, collectPersonData, type PersonExport } from "@/lib/privacy/person-export";
import {
  companyDataProtection,
  forgetDataProtection,
  isYears,
  PHOTO_DAY_CHOICES,
  RETENTION_YEARS,
  retentionYears,
  type DataProtection,
  type RetentionCountry,
} from "@/lib/privacy/data-protection";
import { deletePhotoEverywhere, historiesOf, planAnonymise, runAnonymise } from "@/lib/privacy/anonymise";
import { leaversDue, leaversWithoutDate, photosDue, RETENTION_BATCH } from "@/lib/privacy/retention";
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
  const url = (await photoUrls(tenantId, [emp], { evenWhereOff: true })).get(emp.id);
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
  async (
    ctx,
    input: {
      noMedicalNotes?: boolean;
      anonymise?: Partial<DataProtection["anonymise"]>;
      retention?: Partial<DataProtection["retention"]>;
      leaverPhotos?: Partial<DataProtection["leaverPhotos"]>;
      liveBoardsOff?: boolean;
      clockPhotos?: DataProtection["clockPhotos"];
    },
  ) => {
    if (!ctx.tenantId) throw new NotFoundError("This company isn't available to you.");
    const before = await companyDataProtection(ctx.tenantId);
    const a = input?.anonymise ?? {};
    const r = input?.retention ?? {};
    const ph = input?.leaverPhotos ?? {};
    if (r.enabled !== undefined && typeof r.enabled !== "boolean") throw new Error("Choose on or off.");
    if (r.country !== undefined && r.country !== null && !(r.country in RETENTION_YEARS)) throw new Error("Choose a country from the list.");
    if (r.years !== undefined && r.years !== null && !isYears(r.years)) throw new Error("Choose between 1 and 10 years.");
    if (ph.enabled !== undefined && typeof ph.enabled !== "boolean") throw new Error("Choose on or off.");
    if (ph.days !== undefined && !PHOTO_DAY_CHOICES.includes(ph.days as never)) throw new Error("Choose a number of days from the list.");
    if (input?.liveBoardsOff !== undefined && typeof input.liveBoardsOff !== "boolean") throw new Error("Choose on or off.");
    const cp = input?.clockPhotos;
    if (cp !== undefined) {
      if (!cp || !["NONE", "SOME", "ALL"].includes(cp.off) || !Array.isArray(cp.siteIds) || cp.siteIds.some((x) => typeof x !== "string")) {
        throw new Error("Choose where photos are taken.");
      }
      // Only this company's sites.
      const own = await db.site.count({ where: { tenantId: ctx.tenantId, id: { in: cp.siteIds } } });
      if (own !== new Set(cp.siteIds).size) throw new NotFoundError("A site you chose isn't available. Reload the page and try again.");
    }
    for (const k of ["enabled", "deletePhoto", "deleteDocuments"] as const) {
      if (a[k] !== undefined && typeof a[k] !== "boolean") throw new Error("Choose on or off.");
    }
    if (input?.noMedicalNotes !== undefined && typeof input.noMedicalNotes !== "boolean") throw new Error("Choose on or off.");
    if (a.history !== undefined && a.history !== "REPLACE" && a.history !== "KEEP") throw new Error("Choose how the change history is handled.");
    const after: DataProtection = {
      noMedicalNotes: input?.noMedicalNotes ?? before.noMedicalNotes,
      anonymise: { ...before.anonymise, ...a },
      retention: { ...before.retention, ...r, country: (r.country !== undefined ? r.country : before.retention.country) as RetentionCountry | null },
      leaverPhotos: { ...before.leaverPhotos, ...ph },
      liveBoardsOff: input?.liveBoardsOff ?? before.liveBoardsOff,
      clockPhotos: cp ? { off: cp.off, siteIds: cp.off === "SOME" ? [...new Set(cp.siteIds)] : [] } : before.clockPhotos,
    };
    // Retention anonymises, so it cannot be on while anonymising is off.
    if (!after.anonymise.enabled) after.retention.enabled = false;
    if (after.retention.enabled && !retentionYears(after.retention)) throw new Error("Choose the country first.");
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
    forgetDataProtection(ctx.tenantId);
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
    // company-scope-ok: anonymiseContext holds the person to the caller's reach (assertRecordInReach)
    const { tenantId, settings } = await anonymiseContext(ctx, input.employeeId);
    const emp = await db.employee.findFirst({ where: { id: input.employeeId, tenantId }, select: { id: true, barcode: true, wmsId: true, employeeCode: true } });
    const photo = emp ? (await photoUrls(tenantId, [emp], { evenWhereOff: true })).get(emp.id) : null;
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
    // company-scope-ok: anonymiseContext holds the person to the caller's reach (assertRecordInReach)
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

// ─── Retention review (EU companies) ─────────────────────────────────────────

/**
 * Who may review: the same people who may anonymise (EMPLOYEE_MANAGE and
 * EMPLOYEE_DATA_EXPORT), since the review downloads people's data and then
 * anonymises them or deletes their photo. Whose: leavers of the caller's
 * company at the sites they can open. Nothing here runs on a schedule.
 */
async function retentionContext(ctx: { employeeId: string; tenantId: string | null; role: string }) {
  if (!ctx.tenantId) throw new NotFoundError("This company isn't available to you.");
  if (!(await checkPermission("EMPLOYEE_DATA_EXPORT"))) throw new Error("You need permission to export employee data to review leavers.");
  const [settings, sites] = await Promise.all([companyDataProtection(ctx.tenantId), siteLimit(ctx)]);
  return { tenantId: ctx.tenantId, settings, reach: { tenantId: ctx.tenantId, sites } };
}

type RetentionKind = "leavers" | "photos";

async function dueList(kind: RetentionKind, reach: { tenantId: string; sites: string[] | null }, settings: DataProtection) {
  return kind === "leavers" ? leaversDue(reach, settings, new Date()) : photosDue(reach, settings, new Date());
}

/** Who is due now, read only, for the review window. */
export const getRetentionReview = withRBAC("EMPLOYEE_MANAGE", async (ctx, _input: void) => {
  const { settings, reach } = await retentionContext(ctx);
  const [leavers, photos, noDate] = await Promise.all([dueList("leavers", reach, settings), dueList("photos", reach, settings), leaversWithoutDate(reach)]);
  return {
    years: retentionYears(settings.retention),
    country: settings.retention.country,
    photoDays: settings.leaverPhotos.days,
    leavers,
    photos,
    noDate,
    batchSize: RETENTION_BATCH,
  };
});

/** Exported within this long before the run, as for one person. */
const BATCH_EXPORT_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * The download of the batch now due: everything CloudTime holds about each
 * leaver, or only their photos. Each person in it gets an audit entry, which
 * is what the run checks for. Called by the download route only.
 */
export const exportRetentionBatch = withRBAC("EMPLOYEE_MANAGE", async (ctx, input: { kind: RetentionKind }) => {
  const { tenantId, settings, reach } = await retentionContext(ctx);
  if (input?.kind !== "leavers" && input?.kind !== "photos") throw new NotFoundError("Nothing to download.");
  const list = await dueList(input.kind, reach, settings);
  if (!list?.batch.length) throw new NotFoundError("Nobody is due.");

  const people: PersonExport[] = [];
  for (let i = 0; i < list.batch.length; i += 5) {
    const chunk = await Promise.all(
      list.batch.slice(i, i + 5).map(async (p): Promise<PersonExport | null> => {
        const photo = input.kind === "photos" || settings.anonymise.deletePhoto ? await photoFor(tenantId, p.id) : null;
        if (input.kind === "photos") return photo ? { name: p.name, employeeCode: p.employeeCode, timeZone: "UTC", sections: [], photo } : null;
        const data = await collectPersonData(tenantId, p.id);
        return data ? { ...data, photo } : null;
      }),
    );
    people.push(...chunk.filter((p): p is PersonExport => p !== null));
  }
  if (!people.length) throw new NotFoundError("Nobody is due.");

  const exportedAt = new Date();
  const purpose = input.kind === "leavers" ? "Leavers past the retention period, downloaded before they are anonymised." : "Leaver photos, downloaded before they are deleted.";
  const file = await buildPeopleWorkbook(people, exportedAt, purpose);
  const byCode = new Map(list.batch.map((p) => [p.employeeCode, p.id]));
  for (const p of people) {
    await writeAuditLog({
      tenantId,
      actorId: ctx.employeeId,
      action: input.kind === "leavers" ? "PERSONAL_DATA_EXPORTED" : "EMPLOYEE_PHOTO_EXPORTED",
      entityType: "EMPLOYEE",
      entityId: byCode.get(p.employeeCode)!,
      changes: { after: { reason: "Retention review", people: people.length, sheets: Object.fromEntries(p.sections.map((s) => [s.title, s.rows.length])), photo: p.photo != null } },
    });
  }
  const day = exportedAt.toISOString().slice(0, 10);
  return { file, fileName: `${input.kind === "leavers" ? "Leavers past the retention period" : "Leaver photos"} ${day}.xlsx` };
});

export interface RetentionRunResult {
  done: number;
  skipped: { name: string; employeeCode: string; reason: string }[];
  storageProblems: string[];
}

/**
 * Anonymises the leavers, or deletes the photos, of the batch HR reviewed and
 * downloaded. Only people still due are touched, each one checked again on
 * its own (in reach, not ranked above the caller, in a download from the last
 * 24 hours), and the number typed must match the batch, so nothing runs by
 * accident. There is no undo: the download is the only copy.
 */
export const runRetentionBatch = withRBAC(
  "EMPLOYEE_MANAGE",
  async (ctx, input: { kind: RetentionKind; employeeIds: string[]; confirmCount: number }) => {
    // company-scope-ok: only ids in the caller's own due list (company and sites, by retentionContext) are touched
    const { tenantId, settings, reach } = await retentionContext(ctx);
    const kind = input?.kind;
    const ids = Array.isArray(input?.employeeIds) ? [...new Set(input.employeeIds.filter((v) => typeof v === "string"))] : [];
    if ((kind !== "leavers" && kind !== "photos") || ids.length === 0 || ids.length > RETENTION_BATCH) throw new Error("Reload the review and try again.");
    if (input.confirmCount !== ids.length) throw new Error(`Type ${ids.length} to confirm.`);

    const list = await dueList(kind, reach, settings);
    const due = new Map((list?.batch ?? []).map((p) => [p.id, p]));
    const result: RetentionRunResult = { done: 0, skipped: [], storageProblems: [] };
    const exportAction = kind === "leavers" ? "PERSONAL_DATA_EXPORTED" : "EMPLOYEE_PHOTO_EXPORTED";
    const exported = new Set(
      (
        await db.auditLog.findMany({
          where: { tenantId, action: exportAction, entityId: { in: ids }, createdAt: { gte: new Date(Date.now() - BATCH_EXPORT_FRESH_MS) } },
          select: { entityId: true },
        })
      ).map((a) => a.entityId),
    );
    const histories = kind === "leavers" && settings.anonymise.history === "REPLACE" ? await historiesOf(tenantId, ids.filter((id) => due.has(id))) : new Map();

    for (const id of ids) {
      const person = due.get(id);
      if (!person) {
        result.skipped.push({ name: "", employeeCode: "", reason: "No longer due. Reload the review." });
        continue;
      }
      const skip = (reason: string) => result.skipped.push({ name: person.name, employeeCode: person.employeeCode, reason });
      if (!exported.has(id)) {
        skip("Not in a download from the last 24 hours.");
        continue;
      }
      try {
        await assertNotSenior(ctx as Parameters<typeof assertNotSenior>[0], id);
      } catch (e) {
        skip(e instanceof Error ? e.message : "Not allowed.");
        continue;
      }

      if (kind === "leavers") {
        const known = histories.get(id) ?? [];
        const plan = await planAnonymise(tenantId, id, settings, ctx.employeeId, false, known);
        if (!plan) {
          skip("Not found.");
          continue;
        }
        if (plan.blockers.length) {
          skip(plan.blockers[0]);
          continue;
        }
        const done = await runAnonymise(tenantId, id, settings, known);
        if (!done) {
          skip("Not found.");
          continue;
        }
        result.storageProblems.push(...done.storageProblems);
        await writeAuditLog({
          tenantId,
          actorId: ctx.employeeId,
          action: "PERSONAL_DATA_ANONYMISED",
          entityType: "EMPLOYEE",
          entityId: id,
          changes: { after: { ...done, settings: settings.anonymise, reason: "Retention period", years: retentionYears(settings.retention) } },
        });
        result.done++;
      } else {
        const emp = await db.employee.findFirst({ where: { id, tenantId }, select: { id: true, barcode: true, wmsId: true, employeeCode: true } });
        if (!emp) {
          skip("Not found.");
          continue;
        }
        const photo = await deletePhotoEverywhere(tenantId, emp);
        result.storageProblems.push(...photo.problems);
        if (photo.deleted === 0) {
          skip(photo.problems[0] ?? "No photo was found to delete.");
          continue;
        }
        await writeAuditLog({
          tenantId,
          actorId: ctx.employeeId,
          action: "EMPLOYEE_PHOTO_DELETED",
          entityType: "EMPLOYEE",
          entityId: id,
          changes: { after: { filesDeleted: photo.deleted, reason: "Retention period", days: settings.leaverPhotos.days } },
        });
        result.done++;
      }
    }
    result.storageProblems = [...new Set(result.storageProblems)];
    revalidatePath("/admin/settings");
    revalidatePath("/admin/employees");
    return result;
  },
);

// ─── Company data export (EU Data Act, switching provider) ───────────────────

/**
 * Checks who may download the whole company's data and records that they
 * did, before the download route streams it. Who: COMPANY_DATA_EXPORT, which
 * System Admins hold and any other role only when the company ticks Company
 * Data, Execute. Whose: the caller's own company, never another.
 */
export const startCompanyExport = withRBAC("COMPANY_DATA_EXPORT", async (ctx, input: { photos: boolean }) => {
  if (!ctx.tenantId) throw new NotFoundError("This company isn't available to you.");
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
  if (!tenant) throw new NotFoundError("This company isn't available to you.");
  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.employeeId,
    action: "COMPANY_DATA_EXPORTED",
    // Company level entries are filed under pay periods with the company as
    // the record, as the settings are: the log has no company type.
    entityType: "PAY_PERIOD",
    entityId: ctx.tenantId,
    changes: { after: { photos: input?.photos === true } },
  });
  return { tenantId: ctx.tenantId, name: tenant.name };
});
