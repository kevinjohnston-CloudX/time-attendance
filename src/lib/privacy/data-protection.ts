import { db } from "@/lib/db";

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
}

export const NO_DATA_PROTECTION: DataProtection = { noMedicalNotes: false };

/** Reads the stored value, treating anything missing or unexpected as off. */
export function parseDataProtection(raw: unknown): DataProtection {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { noMedicalNotes: v.noMedicalNotes === true };
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
