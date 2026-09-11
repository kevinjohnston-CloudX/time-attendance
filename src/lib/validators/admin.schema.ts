import { z } from "zod";
import { PayFrequency } from "@prisma/client";

export const ROLES = [
  "EMPLOYEE",
  "SUPERVISOR",
  "PAYROLL_ADMIN",
  "HR_ADMIN",
  "SYSTEM_ADMIN",
] as const;

const LEAVE_CATEGORIES = [
  "PTO",
  "SICK",
  "HOLIDAY",
  "FMLA",
  "BEREAVEMENT",
  "JURY_DUTY",
  "MILITARY",
  "UNPAID",
] as const;

const nullableStr = z.string().nullable().optional().transform((v) => v === undefined ? undefined : (v || null));

export const createEmployeeSchema = z.object({
  name: z.string().min(1),
  email: z.string().email("A valid email address is required"),
  employeeCode: z.string().min(1),
  role: z.enum(ROLES).default("EMPLOYEE"),
  customRoleId: z.string().optional(),
  siteId: z.string().min(1),
  departmentId: z.string().min(1),
  ruleSetId: z.string().min(1),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd"),
  supervisorId: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  wmsId: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  payType: z.enum(["HOURLY", "SALARY"]).nullable().optional(),
  payRate: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().positive().nullable().optional()),
  // Work info
  jobTitle: nullableStr,
  adpWorkerId: nullableStr,
  shiftId: nullableStr,
  holidayRuleId: nullableStr,
  payCategoryId: nullableStr,
  payTypeId: nullableStr,
  // Personal
  phone: nullableStr,
  phone2: nullableStr,
  gender: nullableStr,
  maritalStatus: nullableStr,
  emergencyContact: nullableStr,
  emergencyPhone: nullableStr,
  emergencyRelationship: nullableStr,
  address1: nullableStr,
  address2: nullableStr,
  city: nullableStr,
  state: nullableStr,
  country: nullableStr,
  zipCode: nullableStr,
});

export const updateEmployeeSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  role: z.enum(ROLES).optional(),
  customRoleId: z.string().nullable().optional(),
  supervisorId: z.string().nullable().optional(),
  siteId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  ruleSetId: z.string().min(1).optional(),
  shiftId: nullableStr,
  holidayRuleId: nullableStr,
  payCategoryId: nullableStr,
  isActive: z.boolean().optional(),
  onLeave: z.boolean().optional(),
  wmsId: nullableStr,
  adpWorkerId: nullableStr,
  // Work info
  jobTitle: nullableStr,
  terminationReason: nullableStr,
  // Pay
  payType: z.enum(["HOURLY", "SALARY"]).nullable().optional(),
  payTypeId: nullableStr,
  payRate: z.number().positive().nullable().optional(),
  // Personal
  phone: nullableStr,
  phone2: nullableStr,
  gender: nullableStr,
  maritalStatus: nullableStr,
  // Emergency contact
  emergencyContact: nullableStr,
  emergencyPhone: nullableStr,
  emergencyRelationship: nullableStr,
  // Address
  address1: nullableStr,
  address2: nullableStr,
  city: nullableStr,
  state: nullableStr,
  country: nullableStr,
  zipCode: nullableStr,
});

export const siteSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1).default("America/New_York"),
  address: z.string().optional(),
});

export const updateSiteSchema = siteSchema.extend({
  siteId: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const departmentSchema = z.object({
  name: z.string().min(1),
  siteIds: z.array(z.string().min(1)).min(1),
});

export const updateDepartmentSchema = departmentSchema.extend({
  departmentId: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const leaveTypeSchema = z.object({
  name: z.string().min(1),
  category: z.enum(LEAVE_CATEGORIES),
  accrualRateMinutes: z.number().int().min(0).default(0),
  maxBalanceMinutes: z.number().int().positive().nullable().optional(),
  requiresApproval: z.boolean().default(true),
  isPaid: z.boolean().default(true),
  accrualTracked: z.boolean().default(true),
  externalCode: z.number().int().positive().nullable().optional(),
  payCodeId: z.string().cuid().nullable().optional(),
});

export const updateLeaveTypeSchema = leaveTypeSchema.extend({
  leaveTypeId: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const ruleSetSchema = z.object({
  name: z.string().min(1),
  number: z.coerce.number().int().min(1).nullable().optional(),
  otRateMultiplier: z.number().int().min(100).max(1000).default(150),
  dtRateMultiplier: z.number().int().min(100).max(1000).default(200),
  overtimeRequiresAuth: z.boolean().default(false),
  allowTimesheetOtAuth: z.boolean().default(true),
  otGraceBeforeShiftMinutes: z.number().int().min(0).default(0),
  otGraceAfterShiftMinutes: z.number().int().min(0).default(0),
  dailyOtMinutes: z.number().int().min(0).default(480),
  dailyDtMinutes: z.number().int().min(0).default(720),
  dailyDtMaxMinutes: z.number().int().min(0).default(0),
  weeklyOtEnabled: z.boolean().default(true),
  weeklyOtMinutes: z.number().int().min(0).default(2400),
  weeklyDtMinutes: z.number().int().min(0).default(86400),
  weeklyDtMaxMinutes: z.number().int().min(0).default(0),
  consecutiveDayOtEnabled: z.boolean().default(false),
  consecutiveDayOtDay: z.number().int().min(1).default(7),
  consecutiveDayPayCycleOnly: z.boolean().default(true),
  consecutiveDayOtMaxMinutes: z.number().int().min(0).default(0),
  consecutiveDayDtMaxMinutes: z.number().int().min(0).default(0),
  pairRoundingEnabled: z.boolean().default(false),
  pairRoundingMinutes: z.number().int().min(1).default(15),
  pairRoundingPoint: z.number().int().min(0).default(0),
  pairMinGuaranteedMinutes: z.number().int().min(0).default(0),
  punchRoundingInEnabled: z.boolean().default(false),
  punchRoundingInMinutes: z.number().int().min(1).default(15),
  punchRoundingInPoint: z.number().int().min(0).default(0),
  punchRoundingInApplyToBreaks: z.boolean().default(false),
  punchRoundingOutEnabled: z.boolean().default(false),
  punchRoundingOutMinutes: z.number().int().min(1).default(15),
  punchRoundingOutPoint: z.number().int().min(0).default(0),
  punchRoundingOutApplyToBreaks: z.boolean().default(false),
  shiftRoundingEnabled: z.boolean().default(false),
  shiftRoundingInWindow: z.number().int().min(0).default(0),
  shiftRoundingInGrace: z.number().int().min(0).default(0),
  shiftRoundingOutGrace: z.number().int().min(0).default(0),
  shiftRoundingOutWindow: z.number().int().min(0).default(0),
  mealBreakMinutes: z.number().int().min(0).default(30),
  mealBreakAfterMinutes: z.number().int().min(0).default(300),
  autoDeductMeal: z.boolean().default(false),
  shortBreakMinutes: z.number().int().min(0).default(15),
  shortBreaksPerDay: z.number().int().min(0).default(2),
  longShiftMinutes: z.number().int().min(0).default(720),
  isDefault: z.boolean().default(false),
  payFrequency: z.nativeEnum(PayFrequency).nullable().optional(),
  payPeriodAnchorDate: z.string().nullable().optional(), // "YYYY-MM-DD" string, parsed to Date in action
  weekStartDay: z.number().int().min(0).max(6).default(1),
  otCycle: z.enum(["WEEKLY", "BIWEEKLY", "CUSTOM"]).nullable().optional(),
  otCycleDays: z.number().int().min(1).nullable().optional(),
  otCycleAnchorDate: z.string().nullable().optional(), // "YYYY-MM-DD" string, parsed to Date in action
  defaultPayCodeId: z.string().nullable().optional(),
  autoPayEnabled: z.boolean().default(false),
  autoPayMode: z.enum(["POLICY_HOURS", "SHIFT_HOURS"]).default("POLICY_HOURS"),
  autoPayDaySchedule: z.array(z.object({
    day: z.number().int().min(0).max(6),
    apply: z.boolean(),
    minutes: z.number().int().min(0),
  })).length(7).optional(),
  autoPayPayCodeId: z.string().nullable().optional(),
  autoPayOverflowThresholdMinutes: z.number().int().min(0).default(0),
  autoPayOverflowPayCodeId: z.string().nullable().optional(),
  mealBreakPremiumEnabled: z.boolean().default(false),
  mealBreakPremiumMaxPerDay: z.number().int().min(1).default(2),
  mealBreakPremiumResetEnabled: z.boolean().default(false),
  mealBreakPremiumResetMinutes: z.number().int().min(0).default(0),
  mealBreakPremiumWaivedMsgEnabled: z.boolean().default(false),
  mealBreakPremiumWaivedMsg: z.string().max(250).nullable().optional(),
  mealPremiumUseActualForWindow: z.boolean().default(true),
  mealPremiumUseActualForMinimum: z.boolean().default(true),
  mealPremiumLimitToPayMinutes: z.boolean().default(false),
  mealPremiumAllowTimesheetEdits: z.boolean().default(true),
  mealPremiumUseTransferGroup: z.boolean().default(false),
  mealPremiumRows: z.array(z.object({
    applyFromMinutes: z.number().int().min(0),
    applyToMinutes: z.number().int().min(0),
    minimumMealMinutes: z.number().int().min(0),
    payMinutes: z.number().int().min(0),
    payCodeId: z.string().nullable().optional(),
    payLevel: z.string(),
    inReferenceTime: z.string().nullable().optional(),
    waivePremium: z.boolean(),
    unlessHoursExceed: z.boolean(),
    unlessHoursExceedMinutes: z.number().int().min(0),
    unlessPunchedMeal: z.boolean(),
  })).max(4).optional(),
  flsaEnabled: z.boolean().default(false),
  flsaType: z.enum(["FEDERAL", "CALIFORNIA"]).default("FEDERAL"),
  flsaDistributionFrequency: z.enum(["PER_PERIOD", "WEEKLY"]).default("PER_PERIOD"),
  flsaAdjustmentPayCodeId: z.string().nullable().optional(),
  flsaAdjustmentInRefTime: z.string().nullable().optional(),
  flsaAltPayCodeEnabled: z.boolean().default(false),
  flsaAltPayCodeId: z.string().nullable().optional(),
  flsaAltInRefTime: z.string().nullable().optional(),
  flsaIncludePremiumHours: z.boolean().default(false),
  flsaIncludePayMatrixHours: z.boolean().default(false),
  flsaNoNegativeAdjustment: z.boolean().default(false),
  flsaUseTotalOtPremium: z.boolean().default(false),
  flsaWeeklyOtPayMethod: z.boolean().default(false),
  flsaMaxWeeklyRegularMinutes: z.number().int().min(0).default(2400),
  flsaWeeklyOtLevel: z.enum(["OT1", "OT2"]).default("OT1"),
  flsaApplyFullOtAmount: z.boolean().default(false),
  flsaDistributeMultipleRecords: z.boolean().default(false),
  flsaOtRateComputation: z.enum(["BASE_PLUS_AVG_HALF", "AVG_RATE", "BASE_RATE"]).default("BASE_PLUS_AVG_HALF"),
  flsaOtLevels: z.array(z.string()).optional(),
  flsaIncludeAsRegular: z.array(z.string()).optional(),
});

export const updateRuleSetSchema = ruleSetSchema.extend({
  ruleSetId: z.string().min(1),
  isActive: z.boolean().optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type SiteInput = z.infer<typeof siteSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;
export type DepartmentInput = z.infer<typeof departmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;
export type RuleSetInput = z.infer<typeof ruleSetSchema>;
export type UpdateRuleSetInput = z.infer<typeof updateRuleSetSchema>;

export const adjustLeaveBalanceSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  year: z.number().int(),
  mode: z.enum(["ADD", "SUBTRACT", "SET_AVAILABLE"]),
  enteredMinutes: z.number().int().min(0),
  newBalanceMinutes: z.number().int(),
  note: z.string().min(1, "A reason is required"),
});

export const csvEmployeeRowSchema = z.object({
  name: z.string().min(1, "Name is required"),
  employeeCode: z.string().min(1, "Employee code is required"),
  email: z.string().email("Must be a valid email").optional().or(z.literal("")).transform((v) => v || undefined),
  role: z.string().default("EMPLOYEE").transform((v) => v.trim()),
  customRole: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  site: z.string().min(1, "Site is required"),
  department: z.string().min(1, "Department is required"),
  ruleSet: z.string().min(1, "Rule set is required"),
  hireDate: z.string()
    .refine(
      (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v),
      "Date must be MM/DD/YYYY or YYYY-MM-DD"
    )
    .transform((v) => {
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
        const [mm, dd, yyyy] = v.split("/");
        return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      }
      return v;
    }),
  supervisorCode: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  wmsId: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  payType: z.preprocess(
    (v) => (v === "" || v == null ? null : String(v).toUpperCase()),
    z.enum(["HOURLY", "SALARY"]).nullable().optional()
  ),
  payRate: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().positive().nullable().optional()
  ),
});

export type CsvEmployeeRow = z.infer<typeof csvEmployeeRowSchema>;

export type AdjustLeaveBalanceInput = z.infer<typeof adjustLeaveBalanceSchema>;

export const postAccrualCorrectionSchema = z.object({
  employeeId:   z.string().min(1),
  leaveTypeId:  z.string().min(1),
  year:         z.number().int(),
  deltaMinutes: z.number().int(),
  note:         z.string().min(1, "A reason is required"),
});

export type PostAccrualCorrectionInput = z.infer<typeof postAccrualCorrectionSchema>;
