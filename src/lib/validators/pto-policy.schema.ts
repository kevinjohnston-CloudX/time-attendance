import { z } from "zod";

const ptoPolicyRuleSchema = z.object({
  leaveTypeId:      z.string().min(1),
  minTenureMonths:  z.number().int().min(0),
  maxTenureMonths:  z.number().int().min(1).nullable(),
  annualHours:        z.number().int().min(0).max(9999),
  earnedHoursPerYear: z.number().int().min(0).max(999),
  carryOverHours:     z.number().int().min(0).max(9999).nullable(),
});

export const createPtoPolicySchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  description: z.string().max(500).optional(),
  isDefault:   z.boolean().default(false),
  rules:       z.array(ptoPolicyRuleSchema),
});

export const updatePtoPolicySchema = z.object({
  ptoPolicyId: z.string().min(1),
  name:        z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).nullable().optional(),
  isDefault:   z.boolean().optional(),
  isActive:    z.boolean().optional(),
  rules:       z.array(ptoPolicyRuleSchema).optional(), // full replace when provided
});

export const assignSitePtoPolicySchema = z.object({
  siteId:      z.string().min(1),
  leaveTypeId: z.string().min(1),
  ptoPolicyId: z.string().min(1).nullable(),
});

export const assignEmployeePtoPolicyOverrideSchema = z.object({
  employeeId:  z.string().min(1),
  ptoPolicyId: z.string().min(1).nullable(),
});
