"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { currentIdentity } from "@/lib/rbac/current";
import { employeeRank } from "@/lib/rbac/identity";
import { assertRecordInReach } from "@/lib/rbac/scope";
import { chargeFor, dateKey, syncCurrentPayRates } from "@/lib/pay-rates";

/**
 * An employee's pay rate history, as NovaTime's Pay Rates table. Rate 1 is the
 * pay rate from its effective date; Rate 2 and Rate 3 are reference only.
 * Each row also carries the charge rate billed for that pay: Rate 1 plus the
 * markup, to the cent, or a charge rate set by hand (chargeManual) when an
 * agency agreement does not follow the formula.
 * Changing pay follows the same rules as everywhere else: never your own, and
 * only for someone ranked below you.
 */

export type PayRateRow = {
  effectiveDate: string;
  rate1: number;
  rate2: number | null;
  rate3: number | null;
  /** Percent: 32 is 32%. */
  markupPct: number | null;
  chargeRate: number | null;
  chargeManual: boolean;
  note: string | null;
};

const money = z.number().positive("Rates must be more than 0").max(10_000_000);

const saveSchema = z.object({
  employeeId: z.string().min(1),
  rows: z
    .array(z.object({
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Every row needs an effective date"),
      rate1: money,
      rate2: money.nullable(),
      rate3: money.nullable(),
      markupPct: z.number().min(0, "A markup can't be below 0%").max(1000).nullable().optional(),
      chargeRate: money.nullable().optional(),
      chargeManual: z.boolean().optional(),
      note: z.string().trim().max(500).nullable(),
    }))
    .max(200)
    .refine((rows) => new Set(rows.map((r) => r.effectiveDate)).size === rows.length, "Two rows have the same effective date"),
});

const toRow = (r: {
  effectiveDate: Date; rate1: unknown; rate2: unknown; rate3: unknown;
  markupPct: unknown; chargeRate: unknown; chargeManual: boolean; note: string | null;
}): PayRateRow => ({
  effectiveDate: dateKey(r.effectiveDate),
  rate1: Number(r.rate1),
  rate2: r.rate2 == null ? null : Number(r.rate2),
  rate3: r.rate3 == null ? null : Number(r.rate3),
  markupPct: r.markupPct == null ? null : Number(r.markupPct),
  chargeRate: r.chargeRate == null ? null : Number(r.chargeRate),
  chargeManual: r.chargeManual,
  note: r.note,
});

/**
 * The charge rate a row is saved with: worked out from Rate 1 and the markup
 * here on the server, so the formula holds whatever the screen sent, unless
 * the row says it was set by hand.
 */
function settleCharge(r: { rate1: number; markupPct?: number | null; chargeRate?: number | null; chargeManual?: boolean }) {
  const markupPct = r.markupPct ?? null;
  if (r.chargeManual) {
    if (r.chargeRate == null) throw new Error("A charge rate set by hand needs an amount");
    return { markupPct, chargeRate: r.chargeRate, chargeManual: true };
  }
  return { markupPct, chargeRate: chargeFor(r.rate1, markupPct), chargeManual: false };
}

export const getPayRates = withRBAC("EMPLOYEE_MANAGE", async (actor, input: { employeeId: string }): Promise<PayRateRow[]> => {
  // In the company, and at the admin's sites, as the employee's record is.
  await assertRecordInReach(actor, input.employeeId);
  const rows = await db.employeePayRate.findMany({ where: { employeeId: input.employeeId }, orderBy: { effectiveDate: "desc" } });
  return rows.map(toRow);
});

const describe = (rows: PayRateRow[]) =>
  rows.length
    ? [...rows]
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
        .map((r) =>
          `${r.effectiveDate}: ${r.rate1.toFixed(2)}${r.rate2 != null ? ` / ${r.rate2.toFixed(2)}` : ""}${r.rate3 != null ? ` / ${r.rate3.toFixed(2)}` : ""}` +
          (r.chargeRate != null
            ? `, charge ${r.chargeRate.toFixed(2)}${r.chargeManual ? " (set by hand)" : r.markupPct != null ? ` (${r.markupPct}% markup)` : ""}`
            : "") +
          (r.note ? ` (${r.note})` : ""))
        .join("; ")
    : "—";

export const savePayRates = withRBAC("EMPLOYEE_MANAGE", async (actor, input: z.input<typeof saveSchema>): Promise<PayRateRow[]> => {
  const { tenantId, employeeId: actorId } = actor;
  const parsed = saveSchema.parse(input);
  const { employeeId } = parsed;
  const rows = parsed.rows.map((r) => ({ ...r, ...settleCharge(r) }));
  await assertRecordInReach(actor, employeeId);

  const me = await currentIdentity();
  if (!me) throw new Error("FORBIDDEN");
  if (!me.isSuperAdmin) {
    if (me.employeeId === employeeId) throw new Error("You can't change your own pay");
    const theirs = await employeeRank(employeeId, tenantId ?? "");
    if (theirs === null || theirs >= me.rank) throw new Error("Only someone more senior can change this person's pay");
  }

  const before = (await db.employeePayRate.findMany({ where: { employeeId } })).map(toRow);

  await db.$transaction([
    db.employeePayRate.deleteMany({ where: { employeeId } }),
    db.employeePayRate.createMany({
      data: rows.map((r) => ({
        employeeId,
        effectiveDate: new Date(`${r.effectiveDate}T00:00:00.000Z`),
        rate1: r.rate1,
        rate2: r.rate2,
        rate3: r.rate3,
        markupPct: r.markupPct,
        chargeRate: r.chargeRate,
        chargeManual: r.chargeManual,
        note: r.note || null,
        createdById: actorId || null,
      })),
    }),
  ]);
  if (rows.length === 0) await db.employee.update({ where: { id: employeeId }, data: { payRate: null, chargeRate: null } });
  else await syncCurrentPayRates([employeeId]);

  const after = rows.map((r) => ({ ...r, note: r.note || null }));
  if (describe(before) !== describe(after)) {
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "EMPLOYEE",
      entityId: employeeId,
      action: "EMPLOYEE_UPDATED",
      changes: { fields: [{ field: "Pay rates", before: describe(before), after: describe(after) }] },
    });
  }

  revalidatePath(`/admin/employees/${employeeId}`);
  return after.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
});
