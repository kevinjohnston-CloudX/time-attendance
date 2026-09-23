"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRBAC } from "@/lib/rbac/guard";
import { getRefusedScans, recoverRefusedScans } from "@/lib/services/refused-scans.service";

/**
 * Refused time clock scans on a timecard, and adding the ones payroll
 * confirms.
 *
 * <p>Both behind PAY_PERIOD_MANAGE, the permission payroll's own punch entry
 * on this screen needs (addSingleManualPunch), because recovering a scan is
 * that same act: payroll putting a punch on somebody's timecard. Anyone
 * without it gets FORBIDDEN from both, whatever the browser shows. The person
 * and the pay period are looked up inside the caller's tenant, and every scan
 * id is re-read with the person's own badges and the period's dates, so an id
 * sent from the browser can only ever be one of that person's refused scans.
 */

const idSchema = z.string().min(1).max(64);

export const getTimecardRefusedScans = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ tenantId }, input: unknown) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const { employeeId, payPeriodId } = z.object({ employeeId: idSchema, payPeriodId: idSchema }).parse(input);
    const result = await getRefusedScans(tenantId, employeeId, payPeriodId);
    if (!result) throw new Error("NOT_FOUND");
    return result;
  },
);

const recoverSchema = z.object({
  employeeId: idSchema,
  payPeriodId: idSchema,
  items: z
    .array(z.object({ scanId: idSchema, punchType: z.enum(["CLOCK_IN", "CLOCK_OUT"]) }))
    .min(1, "Pick at least one scan to add.")
    .max(100),
});

export const recoverTimecardRefusedScans = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ tenantId, employeeId: actorId }, input: unknown) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const parsed = recoverSchema.parse(input);
    const result = await recoverRefusedScans(tenantId, actorId || null, parsed);
    revalidatePath("/payroll/timecards");
    return result;
  },
);
