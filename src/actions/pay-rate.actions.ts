"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { currentIdentity } from "@/lib/rbac/current";
import { employeeRank } from "@/lib/rbac/identity";
import { dateKey, syncCurrentPayRates } from "@/lib/pay-rates";

/**
 * An employee's pay rate history, as NovaTime's Pay Rates table. Rate 1 is the
 * pay rate from its effective date; Rate 2 and Rate 3 are reference only.
 * Changing pay follows the same rules as everywhere else: never your own, and
 * only for someone ranked below you.
 */

export type PayRateRow = {
  effectiveDate: string;
  rate1: number;
  rate2: number | null;
  rate3: number | null;
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
      note: z.string().trim().max(500).nullable(),
    }))
    .max(200)
    .refine((rows) => new Set(rows.map((r) => r.effectiveDate)).size === rows.length, "Two rows have the same effective date"),
});

async function employeeInCompany(employeeId: string, tenantId: string | null) {
  const emp = await db.employee.findFirst({ where: { id: employeeId, tenantId: tenantId ?? "__none__" }, select: { id: true } });
  if (!emp) throw new Error("Employee not found");
}

const toRow = (r: { effectiveDate: Date; rate1: unknown; rate2: unknown; rate3: unknown; note: string | null }): PayRateRow => ({
  effectiveDate: dateKey(r.effectiveDate),
  rate1: Number(r.rate1),
  rate2: r.rate2 == null ? null : Number(r.rate2),
  rate3: r.rate3 == null ? null : Number(r.rate3),
  note: r.note,
});

export const getPayRates = withRBAC("EMPLOYEE_MANAGE", async ({ tenantId }, input: { employeeId: string }): Promise<PayRateRow[]> => {
  await employeeInCompany(input.employeeId, tenantId);
  const rows = await db.employeePayRate.findMany({ where: { employeeId: input.employeeId }, orderBy: { effectiveDate: "desc" } });
  return rows.map(toRow);
});

const describe = (rows: PayRateRow[]) =>
  rows.length
    ? [...rows]
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
        .map((r) => `${r.effectiveDate}: $${r.rate1.toFixed(2)}${r.rate2 != null ? ` / $${r.rate2.toFixed(2)}` : ""}${r.rate3 != null ? ` / $${r.rate3.toFixed(2)}` : ""}${r.note ? ` (${r.note})` : ""}`)
        .join("; ")
    : "—";

export const savePayRates = withRBAC("EMPLOYEE_MANAGE", async ({ tenantId, employeeId: actorId }, input: z.input<typeof saveSchema>): Promise<PayRateRow[]> => {
  const { employeeId, rows } = saveSchema.parse(input);
  await employeeInCompany(employeeId, tenantId);

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
        note: r.note || null,
        createdById: actorId || null,
      })),
    }),
  ]);
  if (rows.length === 0) await db.employee.update({ where: { id: employeeId }, data: { payRate: null } });
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
