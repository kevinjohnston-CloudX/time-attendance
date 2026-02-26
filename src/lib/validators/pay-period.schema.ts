import { z } from "zod";

export const payPeriodIdSchema = z.object({
  payPeriodId: z.string().min(1),
});

export const reopenPayPeriodSchema = z.object({
  payPeriodId: z.string().min(1),
  reason: z.string().min(1, "Reason is required"),
});
