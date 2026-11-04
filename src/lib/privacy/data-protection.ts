import { db } from "@/lib/db";
import { isYears, PHOTO_DAY_CHOICES, RETENTION_YEARS, type RetentionCountry } from "./retention-rules";

/**
 * A company's data protection settings, for EU companies: the rules a company
 * switches on because its people work where EU data protection law applies.
 * Kept as one JSON value on the company (tenants."dataProtection").
 *
 * <p>Empty, which every existing company is, means every switch is off and
 * CloudTime works exactly as it did before these settings existed. Add a
 * setting here as optional, with off as what a missing value means.
 */
export interface DataProtection {
  /**
   * Sick leave requests take no note, so no diagnosis or cause is ever
   * stored. In the Netherlands an employer may not record the nature or cause
   * of an illness, even when the employee offers it; in Germany the employer
   * is owed only the fact and the length of the absence.
   */
  noMedicalNotes: boolean;
  /**
   * Anonymising a person who has left: their identity is removed and their
   * hours, timesheets, leave and pay history stay under "Former employee"
   * and their employee code, for the years payroll and working time law
   * require. Off means the action is not offered at all.
   */
  anonymise: {
    enabled: boolean;
    /** Delete the time clock photo, every stored copy and version of it. */
    deletePhoto: boolean;
    /** Delete the files uploaded to the record. */
    deleteDocuments: boolean;
    /** REPLACE: swap the person's details for the anonymous name inside the change history. KEEP: leave the history as it is. */
    history: "REPLACE" | "KEEP";
  };
  /**
   * How long a leaver is kept before they are listed for anonymising: the
   * years payroll and tax law ask for, counted from the end of the year they
   * left. Nothing runs by itself; HR reviews the list, downloads it, and
   * confirms. Needs anonymise on.
   */
  retention: {
    enabled: boolean;
    /** The country whose rules the period follows; null until one is chosen. */
    country: RetentionCountry | null;
    /** Null means the country's period ({@link RETENTION_YEARS}). */
    years: number | null;
  };
  /** A leaver's time clock photo is listed for deletion this many days after they leave. */
  leaverPhotos: { enabled: boolean; days: number };
}

export { isYears, PHOTO_DAY_CHOICES, RETENTION_COUNTRY_LABEL, RETENTION_YEARS, retentionYears, type RetentionCountry } from "./retention-rules";

export const NO_DATA_PROTECTION: DataProtection = {
  noMedicalNotes: false,
  anonymise: { enabled: false, deletePhoto: true, deleteDocuments: true, history: "REPLACE" },
  retention: { enabled: false, country: null, years: null },
  leaverPhotos: { enabled: false, days: 30 },
};

/** Reads the stored value, treating anything missing or unexpected as off. */
export function parseDataProtection(raw: unknown): DataProtection {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const a = v.anonymise && typeof v.anonymise === "object" ? (v.anonymise as Record<string, unknown>) : {};
  const r = v.retention && typeof v.retention === "object" ? (v.retention as Record<string, unknown>) : {};
  const ph = v.leaverPhotos && typeof v.leaverPhotos === "object" ? (v.leaverPhotos as Record<string, unknown>) : {};
  const d = NO_DATA_PROTECTION.anonymise;
  return {
    noMedicalNotes: v.noMedicalNotes === true,
    anonymise: {
      enabled: a.enabled === true,
      deletePhoto: typeof a.deletePhoto === "boolean" ? a.deletePhoto : d.deletePhoto,
      deleteDocuments: typeof a.deleteDocuments === "boolean" ? a.deleteDocuments : d.deleteDocuments,
      history: a.history === "KEEP" ? "KEEP" : "REPLACE",
    },
    retention: {
      enabled: r.enabled === true,
      country: typeof r.country === "string" && r.country in RETENTION_YEARS ? (r.country as RetentionCountry) : null,
      years: isYears(r.years) ? r.years : null,
    },
    leaverPhotos: {
      enabled: ph.enabled === true,
      days: PHOTO_DAY_CHOICES.includes(ph.days as never) ? (ph.days as number) : NO_DATA_PROTECTION.leaverPhotos.days,
    },
  };
}

export async function companyDataProtection(tenantId: string | null | undefined): Promise<DataProtection> {
  if (!tenantId) return NO_DATA_PROTECTION;
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { dataProtection: true } });
  return parseDataProtection(t?.dataProtection);
}

/** Whether a leave type of this category takes no note in a company with these settings. */
export function leaveTypeTakesNoNote(settings: DataProtection, category: string | null | undefined): boolean {
  return settings.noMedicalNotes && category === "SICK";
}

/**
 * Whether a note on this person's request for this leave type must be left
 * out. One small read; false for every company that has not switched it on.
 */
export async function noteKeptOut(employeeId: string, leaveTypeId: string): Promise<boolean> {
  const [emp, type] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId }, select: { tenant: { select: { dataProtection: true } } } }),
    db.leaveType.findUnique({ where: { id: leaveTypeId }, select: { category: true } }),
  ]);
  return leaveTypeTakesNoNote(parseDataProtection(emp?.tenant.dataProtection), type?.category);
}

/** iv:tag:ciphertext, as encryptPii writes. Anything else was stored as typed. */
const ENCRYPTED = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;

/**
 * The person's contact fields as they really are. Ones saved from the
 * employee form are encrypted; ones that arrived by import are stored as
 * typed, and decryptPiiFields alone returns null for those, which would leave
 * them out of an export and out of what anonymising looks for.
 */
export function readablePii<T extends Partial<Record<string, unknown>>>(record: T, decrypt: (v: string) => string | null): T {
  const out: Record<string, unknown> = { ...record };
  for (const f of ["phone", "phone2", "gender", "maritalStatus", "emergencyContact", "emergencyPhone", "emergencyRelationship", "address1", "address2", "city", "state", "country", "zipCode"]) {
    const v = out[f];
    if (typeof v === "string" && v) out[f] = ENCRYPTED.test(v) ? decrypt(v) : v.trim() || null;
  }
  return out as T;
}
