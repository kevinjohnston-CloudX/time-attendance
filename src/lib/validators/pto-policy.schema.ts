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
  carryOverHours:          z.number().int().min(0).max(9999).nullable(),
  carryOverToLeaveTypeId:  z.string().nullable().optional(),
  maxAnnualHours:          z.number().positive().max(9999).nullable(),
  maxBalanceHours:         z.number().positive().max(9999).nullable(),
  payCodeId:               z.string().nullable().optional(),
});

const postingScheduleSchema = z.object({
  rateMode:          AccrualRateModeEnum.default("YEARLY"),
  serviceMonthBasis: ServiceMonthBasisEnum.default("HIRE_DATE"),
  postingAnchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform(v => v ? new Date(v + "T12:00:00Z") : null),
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
    name:          z.string().min(1).max(100).trim(),
    description:   z.string().max(500).optional(),
    isDefault:     z.boolean().default(false),
    leaveTypeId:   z.string().min(1),
    maxDailyHours: z.number().positive().max(24).nullable().optional(),
    allowNegativeBalance:       z.boolean().default(false),
    maxNegativeHours:           z.number().positive().max(9999).nullable().optional(),
    carryOverEnabled:           z.boolean().default(true),
    carryOverRespectMaxBalance: z.boolean().default(false),
    rules:                      z.array(ptoPolicyRuleSchema),
  })
  .merge(postingScheduleSchema);

export const updatePtoPolicySchema = z
  .object({
    ptoPolicyId:   z.string().min(1),
    name:          z.string().min(1).max(100).trim().optional(),
    description:   z.string().max(500).nullable().optional(),
    isDefault:     z.boolean().optional(),
    isActive:      z.boolean().optional(),
    leaveTypeId:   z.string().min(1).optional(),
    maxDailyHours: z.number().positive().max(24).nullable().optional(),
    allowNegativeBalance:       z.boolean().optional(),
    maxNegativeHours:           z.number().positive().max(9999).nullable().optional(),
    carryOverEnabled:           z.boolean().optional(),
    carryOverRespectMaxBalance: z.boolean().optional(),
    rules:                      z.array(ptoPolicyRuleSchema).optional(),
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
