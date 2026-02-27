import { z } from "zod";

const ROLES = [
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

export const createEmployeeSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  username: z.string().min(3),
  password: z.string().min(8, "Password must be at least 8 characters"),
  employeeCode: z.string().min(1),
  role: z.enum(ROLES).default("EMPLOYEE"),
  siteId: z.string().min(1),
  departmentId: z.string().min(1),
  ruleSetId: z.string().min(1),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd"),
  supervisorId: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
});

export const updateEmployeeSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  supervisorId: z.string().nullable().optional(),
  siteId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  ruleSetId: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
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
  siteId: z.string().min(1),
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
  carryOverMinutes: z.number().int().min(0).default(0),
  requiresApproval: z.boolean().default(true),
  isPaid: z.boolean().default(true),
});

export const updateLeaveTypeSchema = leaveTypeSchema.extend({
  leaveTypeId: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const ruleSetSchema = z.object({
  name: z.string().min(1),
  dailyOtMinutes: z.number().int().min(0).default(480),
  dailyDtMinutes: z.number().int().min(0).default(720),
  weeklyOtMinutes: z.number().int().min(0).default(2400),
  consecutiveDayOtDay: z.number().int().min(1).default(7),
  punchRoundingMinutes: z.number().int().min(0).default(0),
  mealBreakMinutes: z.number().int().min(0).default(30),
  mealBreakAfterMinutes: z.number().int().min(0).default(300),
  autoDeductMeal: z.boolean().default(false),
  shortBreakMinutes: z.number().int().min(0).default(15),
  shortBreaksPerDay: z.number().int().min(0).default(2),
  longShiftMinutes: z.number().int().min(0).default(720),
  isDefault: z.boolean().default(false),
});

export const updateRuleSetSchema = ruleSetSchema.extend({
  ruleSetId: z.string().min(1),
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

export const setAnnualLeaveDaysSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  year: z.number().int(),
  /** null = clear override, fall back to leave type global rate */
  annualDays: z.number().int().min(0).nullable(),
});

export const adjustLeaveBalanceSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  year: z.number().int(),
  newBalanceMinutes: z.number().int().min(0),
  note: z.string().min(1, "A reason is required"),
});

export type SetAnnualLeaveDaysInput = z.infer<typeof setAnnualLeaveDaysSchema>;
export type AdjustLeaveBalanceInput = z.infer<typeof adjustLeaveBalanceSchema>;
