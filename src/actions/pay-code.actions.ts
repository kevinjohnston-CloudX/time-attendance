"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";

// ─── List pay codes for tenant ──────────────────────────────────────────────

export const getPayCodes = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [];

    return db.payCode.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: "asc" },
    });
  }
);

// ─── Set pay code on a work segment ─────────────────────────────────────────

const setSegmentPayCodeSchema = z.object({
  segmentId: z.string(),
  payCodeId: z.string().nullable(),
});

export const setSegmentPayCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: z.infer<typeof setSegmentPayCodeSchema>) => {
    const { segmentId, payCodeId } = setSegmentPayCodeSchema.parse(input);

    await db.workSegment.update({
      where: { id: segmentId },
      data: { payCodeId },
    });

    return { success: true };
  }
);
