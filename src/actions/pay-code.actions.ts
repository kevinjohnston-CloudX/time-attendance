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

// ─── Set pay bucket on a work segment ────────────────────────────────────────

const setSegmentPayBucketSchema = z.object({
  segmentId: z.string(),
  payBucket: z.string().nullable(),
});

export const setSegmentPayBucket = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: z.infer<typeof setSegmentPayBucketSchema>) => {
    const { segmentId, payBucket } = setSegmentPayBucketSchema.parse(input);

    await db.workSegment.update({
      where: { id: segmentId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { payBucketOverride: payBucket ? (payBucket as any) : null },
    });

    return { success: true };
  }
);

// ─── Set pay bucket for an absent day (creates/deletes a 0-duration marker) ──

const setAbsentDayPayBucketSchema = z.object({
  timesheetId: z.string(),
  segmentDate: z.string(), // "YYYY-MM-DD"
  payBucket: z.string().nullable(),
});

export const setAbsentDayPayBucket = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: z.infer<typeof setAbsentDayPayBucketSchema>) => {
    const { timesheetId, segmentDate, payBucket } =
      setAbsentDayPayBucketSchema.parse(input);

    const date = new Date(segmentDate + "T00:00:00.000Z");

    if (!payBucket) {
      await db.workSegment.deleteMany({
        where: { timesheetId, segmentDate: date, durationMinutes: 0, segmentType: "LEAVE" },
      });
      return { success: true };
    }

    const existing = await db.workSegment.findFirst({
      where: { timesheetId, segmentDate: date, durationMinutes: 0, segmentType: "LEAVE" },
    });

    if (existing) {
      await db.workSegment.update({
        where: { id: existing.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { payBucket: payBucket as any },
      });
    } else {
      await db.workSegment.create({
        data: {
          timesheetId,
          segmentType: "LEAVE",
          startTime: date,
          endTime: date,
          durationMinutes: 0,
          segmentDate: date,
          isPaid: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payBucket: payBucket as any,
        },
      });
    }

    return { success: true };
  }
);
