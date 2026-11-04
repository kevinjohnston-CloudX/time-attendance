import { DeleteObjectCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { decryptPii } from "@/lib/crypto/pii";
import { removePhoto } from "@/lib/presence/photos";
import { deleteFromStorage } from "@/lib/supabase-storage";
import { readablePii, type DataProtection } from "./data-protection";

/**
 * Anonymising a person who has left, for a company that switched it on
 * (DataProtection.anonymise). Their identity goes; their hours, timesheets,
 * leave, balances and pay rate history stay, under "Former employee" and
 * their employee code, for the years payroll and working time law require.
 *
 * <p>Server only, and called only after the action has checked the
 * permission, the reach, the company setting, that the person has left, that
 * their export was downloaded, and the typed confirmation. There is no undo:
 * the export the person's administrator downloaded first is the only copy.
 *
 * <p>planAnonymise only reads. runAnonymise changes the database in one
 * transaction, then deletes the photo and the document files, which cannot
 * be part of a transaction; a storage failure is reported, not hidden.
 */

export const anonymisedName = (employeeCode: string) => `Former employee ${employeeCode}`;

/** The profile fields that are cleared, by the label the export window uses. */
const CLEARED_FIELDS: { key: string; label: string }[] = [
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "gender", label: "Gender" },
  { key: "maritalStatus", label: "Marital status" },
  { key: "phone", label: "Phone" },
  { key: "phone2", label: "Second phone" },
  { key: "address1", label: "Address" },
  { key: "address2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State or region" },
  { key: "zipCode", label: "Postal code" },
  { key: "country", label: "Country" },
  { key: "emergencyContact", label: "Emergency contact" },
  { key: "emergencyPhone", label: "Emergency contact phone" },
  { key: "emergencyRelationship", label: "Emergency contact relationship" },
  { key: "wmsName", label: "Name on the time clocks" },
  { key: "terminationReason", label: "Termination reason" },
];

export interface AnonymisePlan {
  name: string;
  employeeCode: string;
  anonymousName: string;
  /** Why it cannot run now, in plain words. Empty when it can. */
  blockers: string[];
  /** Profile fields that hold something and will be cleared. */
  fields: string[];
  emails: number;
  signIns: number;
  leaveNotes: number;
  documents: number;
  hasPhoto: boolean;
  historyEntries: number;
  /** What stays, so the window can say it. */
  kept: { punches: number; timesheets: number; leaveRequests: number; payRates: number };
  /** When the person's data was last exported, if ever. */
  exportedAt: Date | null;
}

const EXPORT_FRESH_MS = 24 * 60 * 60 * 1000;

/** Every value that names or reaches the person, to find and replace in the change history. */
function identifyingValues(p: { name: string | null; email: string | null; workEmail: string | null; phone: string | null; phone2: string | null }): string[] {
  return [p.name, p.email, p.workEmail, p.phone, p.phone2].filter((v): v is string => !!v && v.trim().length >= 3);
}

async function loadPerson(tenantId: string, employeeId: string) {
  const emp = await db.employee.findFirst({
    where: { id: employeeId, tenantId },
    include: { user: { select: { id: true, name: true, email: true, workEmail: true, passwordHash: true } } },
  });
  return emp ? { emp, pii: readablePii(emp, decryptPii) } : null;
}

/** The audit entries that hold one of the person's identifying values in their details. */
async function historyEntriesWith(tenantId: string, values: string[]) {
  if (values.length === 0) return [];
  const patterns = values.map((v) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  return db.$queryRaw<{ id: string; changes: unknown }[]>`
    SELECT id, changes FROM audit_logs
    WHERE "tenantId" = ${tenantId} AND changes IS NOT NULL AND changes::text ILIKE ANY(${patterns})`;
}

type HistoryRow = { id: string; changes: unknown };

/**
 * The change history entries of several people, from one search of the log
 * instead of one each (a search reads the company's whole log). For the
 * retention batch.
 */
export async function historiesOf(tenantId: string, employeeIds: string[]): Promise<Map<string, HistoryRow[]>> {
  const people = await Promise.all(employeeIds.map(async (id) => {
    const loaded = await loadPerson(tenantId, id);
    return { id, values: loaded ? identifyingValues({ name: loaded.emp.user.name, email: loaded.emp.user.email, workEmail: loaded.emp.user.workEmail, phone: loaded.pii.phone, phone2: loaded.pii.phone2 }) : [] };
  }));
  const rows = await historyEntriesWith(tenantId, [...new Set(people.flatMap((p) => p.values))]);
  const texts = rows.map((r) => JSON.stringify(r.changes).toLowerCase());
  return new Map(people.map((p) => {
    const lower = p.values.map((v) => v.toLowerCase());
    return [p.id, rows.filter((_, i) => lower.some((v) => texts[i].includes(v)))];
  }));
}

export async function planAnonymise(
  tenantId: string,
  employeeId: string,
  settings: DataProtection,
  actorId: string,
  photoPresent: boolean,
  /** The person's history entries when already found, by {@link historiesOf}. */
  knownHistory?: HistoryRow[],
): Promise<AnonymisePlan | null> {
  const loaded = await loadPerson(tenantId, employeeId);
  if (!loaded) return null;
  const { emp, pii } = loaded;
  const values = identifyingValues({ name: emp.user.name, email: emp.user.email, workEmail: emp.user.workEmail, phone: pii.phone, phone2: pii.phone2 });

  const [accounts, sessions, refresh, push, leaveNotes, documents, history, punches, timesheets, leaveRequests, payRates, lastExport] = await Promise.all([
    db.account.count({ where: { userId: emp.userId } }),
    db.session.count({ where: { userId: emp.userId } }),
    db.refreshToken.count({ where: { userId: emp.userId } }),
    db.pushDevice.count({ where: { userId: emp.userId } }),
    db.leaveRequest.count({ where: { employeeId, OR: [{ note: { not: null } }, { reviewNote: { not: null } }] } }),
    db.document.count({ where: { employeeId } }),
    knownHistory ?? historyEntriesWith(tenantId, values),
    db.punch.count({ where: { employeeId } }),
    db.timesheet.count({ where: { employeeId } }),
    db.leaveRequest.count({ where: { employeeId } }),
    db.employeePayRate.count({ where: { employeeId } }),
    db.auditLog.findFirst({
      where: { tenantId, entityId: employeeId, action: "PERSONAL_DATA_EXPORTED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const blockers: string[] = [];
  if (!settings.anonymise.enabled) blockers.push("Anonymising is switched off for this company in Company Settings.");
  if (emp.isActive) blockers.push("This person is still active. Only someone who has left can be anonymised.");
  if (employeeId === actorId) blockers.push("You can't anonymise your own record.");
  if (emp.user.name === anonymisedName(emp.employeeCode)) blockers.push("This person has already been anonymised.");
  const exportedAt = lastExport?.createdAt ?? null;
  if (!exportedAt || Date.now() - exportedAt.getTime() > EXPORT_FRESH_MS) {
    blockers.push("Download this person's data with Export data first. It must be from the last 24 hours, because it is the only copy kept.");
  }

  return {
    name: emp.user.name ?? emp.employeeCode,
    employeeCode: emp.employeeCode,
    anonymousName: anonymisedName(emp.employeeCode),
    blockers,
    fields: CLEARED_FIELDS.filter((f) => (pii as Record<string, unknown>)[f.key] != null && (pii as Record<string, unknown>)[f.key] !== "").map((f) => f.label),
    emails: [emp.user.email, emp.user.workEmail].filter(Boolean).length,
    signIns: accounts + sessions + refresh + push + (emp.user.passwordHash ? 1 : 0),
    leaveNotes,
    documents: settings.anonymise.deleteDocuments ? documents : 0,
    hasPhoto: settings.anonymise.deletePhoto && photoPresent,
    historyEntries: settings.anonymise.history === "REPLACE" ? history.length : 0,
    kept: { punches, timesheets, leaveRequests, payRates },
    exportedAt,
  };
}

/** Replaces every occurrence of the person's values in a JSON value, keys and structure untouched. */
export function scrubJson(value: unknown, values: string[], replacement: string): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const v of values) out = out.split(v).join(replacement);
    return out;
  }
  if (Array.isArray(value)) return value.map((x) => scrubJson(x, values, replacement));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubJson(v, values, replacement)]));
  }
  return value;
}

export interface AnonymiseResult {
  fieldsCleared: number;
  signInsRemoved: number;
  leaveNotesCleared: number;
  historyEntriesUpdated: number;
  documentsDeleted: number;
  photoFilesDeleted: number;
  /** Plain words for anything storage refused; the database part still stands. */
  storageProblems: string[];
}

/** Every stored version of every file under these names in the photo bucket. */
async function purgePhotoVersions(keys: string[]): Promise<{ deleted: number; problems: string[] }> {
  const { ON_SITE_PHOTOS_REGION: region, ON_SITE_PHOTOS_BUCKET: bucket, ON_SITE_PHOTOS_ACCESS_KEY_ID: id, ON_SITE_PHOTOS_SECRET_ACCESS_KEY: secret } = process.env;
  if (!region || !bucket || !id || !secret || keys.length === 0) return { deleted: 0, problems: [] };
  const client = new S3Client({ region, credentials: { accessKeyId: id, secretAccessKey: secret } });
  let deleted = 0;
  const problems: string[] = [];
  for (const key of new Set(keys)) {
    try {
      const listed = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
      const versions = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])].filter((v) => v.Key === key);
      for (const v of versions) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: v.VersionId }));
        deleted++;
      }
    } catch (e) {
      problems.push(`A copy of the photo could not be deleted (${e instanceof Error ? e.name : "storage error"}). Ask support to remove it.`);
    }
  }
  return { deleted, problems };
}

/**
 * Deletes a person's time clock photo for good: the file, the copy
 * removePhoto keeps under removed/, and every earlier version the bucket
 * keeps. The badges stay on the record, so they still lead to it; removePhoto
 * never takes a file another employee could own.
 */
export async function deletePhotoEverywhere(
  tenantId: string,
  person: { id: string; barcode: string | null; wmsId: string | null; employeeCode: string },
): Promise<{ deleted: number; problems: string[] }> {
  const problems: string[] = [];
  let keys: string[] = [];
  try {
    const removed = await removePhoto(tenantId, person);
    keys = removed.removed.flatMap((r) => [r.key, r.savedAs]);
    if (removed.kept.length) problems.push("A photo file shared with another employee's badge was left in place.");
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code !== "PHOTOS_OFF") problems.push("The photo store could not be read, so the photo was not deleted. Ask support to remove it.");
  }
  const purge = await purgePhotoVersions(keys);
  return { deleted: purge.deleted, problems: [...problems, ...purge.problems] };
}

export async function runAnonymise(
  tenantId: string,
  employeeId: string,
  settings: DataProtection,
  knownHistory?: HistoryRow[],
): Promise<AnonymiseResult | null> {
  const loaded = await loadPerson(tenantId, employeeId);
  if (!loaded) return null;
  const { emp, pii } = loaded;
  const replacement = anonymisedName(emp.employeeCode);
  const values = identifyingValues({ name: emp.user.name, email: emp.user.email, workEmail: emp.user.workEmail, phone: pii.phone, phone2: pii.phone2 });
  const fieldsCleared = CLEARED_FIELDS.filter((f) => (pii as Record<string, unknown>)[f.key] != null && (pii as Record<string, unknown>)[f.key] !== "").length;
  const documents = settings.anonymise.deleteDocuments ? await db.document.findMany({ where: { employeeId }, select: { id: true, fileUrl: true } }) : [];
  const history = settings.anonymise.history === "REPLACE" ? (knownHistory ?? (await historyEntriesWith(tenantId, values))) : [];

  const counts = await db.$transaction(async (tx) => {
    const [a, s, r, p, t] = await Promise.all([
      tx.account.deleteMany({ where: { userId: emp.userId } }),
      tx.session.deleteMany({ where: { userId: emp.userId } }),
      tx.refreshToken.deleteMany({ where: { userId: emp.userId } }),
      tx.pushDevice.deleteMany({ where: { userId: emp.userId } }),
      tx.passwordResetToken.deleteMany({ where: { userId: emp.userId } }),
    ]);
    await tx.user.update({
      where: { id: emp.userId },
      data: { name: replacement, email: null, workEmail: null, passwordHash: null, image: null, username: null, mustChangePassword: false },
    });
    await tx.employee.updateMany({
      where: { id: employeeId, tenantId },
      data: Object.fromEntries(CLEARED_FIELDS.map((f) => [f.key, null])),
    });
    const notes = await tx.leaveRequest.updateMany({
      where: { employeeId, OR: [{ note: { not: null } }, { reviewNote: { not: null } }] },
      data: { note: null, reviewNote: null },
    });
    for (const h of history) {
      await tx.auditLog.update({ where: { id: h.id }, data: { changes: scrubJson(h.changes, values, replacement) as object } });
    }
    if (documents.length) await tx.document.deleteMany({ where: { employeeId, id: { in: documents.map((d) => d.id) } } });
    return { signIns: a.count + s.count + r.count + p.count + t.count + (emp.user.passwordHash ? 1 : 0), notes: notes.count };
  });

  // Storage, only once the database part has committed, so a failed run never
  // loses the photo or a file while the person still has their name.
  const storageProblems: string[] = [];
  let photoFilesDeleted = 0;
  if (settings.anonymise.deletePhoto) {
    const photo = await deletePhotoEverywhere(tenantId, emp);
    photoFilesDeleted = photo.deleted;
    storageProblems.push(...photo.problems);
  }

  // Document files. deleteFromStorage logs a refused delete rather than
  // throwing; storage it cannot reach at all throws, and is reported.
  let unreachable = 0;
  for (const d of documents) {
    try {
      await deleteFromStorage(d.fileUrl);
    } catch {
      unreachable++;
    }
  }
  if (unreachable) storageProblems.push(`Document storage could not be reached, so ${unreachable === 1 ? "1 file was" : `${unreachable} files were`} not deleted. Ask support to remove ${unreachable === 1 ? "it" : "them"}.`);

  return {
    fieldsCleared,
    signInsRemoved: counts.signIns,
    leaveNotesCleared: counts.notes,
    historyEntriesUpdated: history.length,
    documentsDeleted: documents.length,
    photoFilesDeleted,
    storageProblems,
  };
}
