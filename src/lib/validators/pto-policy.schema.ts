import { z } from "zod";

export const AccrualPostingFreqEnum = z.enum([
  "PER_PAY_PERIOD",
  "DAILY",
  "WEEKLY",
  "BI_WEEKLY",
  "SEMI_MONTHLY",
  "MONTHLY",
  "EVERY_2_MONTHS",
  "QUARTERLY",
  "EVERY_4_MONTHS",
  "SEMI_ANNUALLY",
  "ANNUALLY",
  "ANNUALLY_HIRE",
  "ANNUALLY_FIXED",
]);

export const AccrualRateModeEnum = z.enum(["YEARLY", "PER_POSTING"]);

export const ServiceMonthBasisEnum = z.enum([
  "HIRE_DATE",
  "ADJUSTED_HIRE_DATE",
  "TITLE_CHANGE_DATE",
  "ORIENTATION_DATE",
  "USER_DATE_2",
]);

const ptoPolicyRuleSchema = z.object({
  leaveTypeId:      z.string().min(1),
  minTenureMonths:  z.number().int().min(0),
  maxTenureMonths:  z.number().int().min(1).nullable(),
  annualHours:        z.number().min(0).max(9999),
  earnedHoursPerYear: z.number().min(0).max(999),
  carryOverHours:     z.number().int().min(0).max(9999).nullable(),
});

const postingScheduleSchema = z.object({
  rateMode:          AccrualRateModeEnum.default("YEARLY"),
  serviceMonthBasis: ServiceMonthBasisEnum.default("HIRE_DATE"),
  posting1Freq:      AccrualPostingFreqEnum.default("PER_PAY_PERIOD"),
  posting1Month: z.number().int().min(1).max(12).nullable().optional(),
  posting1Day:   z.number().int().min(1).max(31).nullable().optional(),
  dualPosting:   z.boolean().default(false),
  posting2Freq:  AccrualPostingFreqEnum.nullable().optional(),
  posting2Month: z.number().int().min(1).max(12).nullable().optional(),
  posting2Day:   z.number().int().min(1).max(31).nullable().optional(),
  balanceReset:  z.boolean().default(false),
  resetMonth:    z.number().int().min(1).max(12).nullable().optional(),
  resetDay:      z.number().int().min(1).max(31).nullable().optional(),
});

export const createPtoPolicySchema = z
  .object({
    name:        z.string().min(1).max(100).trim(),
    description: z.string().max(500).optional(),
    isDefault:   z.boolean().default(false),
    rules:       z.array(ptoPolicyRuleSchema),
  })
  .merge(postingScheduleSchema);

export const updatePtoPolicySchema = z
  .object({
    ptoPolicyId: z.string().min(1),
    name:        z.string().min(1).max(100).trim().optional(),
    description: z.string().max(500).nullable().optional(),
    isDefault:   z.boolean().optional(),
    isActive:    z.boolean().optional(),
    rules:       z.array(ptoPolicyRuleSchema).optional(),
  })
  .merge(postingScheduleSchema.partial());

export const assignSitePtoPolicySchema = z.object({
  siteId:      z.string().min(1),
  leaveTypeId: z.string().min(1),
  ptoPolicyId: z.string().min(1).nullable(),
});

export const assignEmployeePtoPolicyOverrideSchema = z.object({
  employeeId:  z.string().min(1),
  ptoPolicyId: z.string().min(1).nullable(),
});
