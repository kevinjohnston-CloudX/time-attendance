import { z } from "zod";

const ptoPolicyBandSchema = z.object({
  leaveTypeId:     z.string().min(1),
  minTenureMonths: z.number().int().min(0),
  maxTenureMonths: z.number().int().min(1).nullable().optional(),
  annualDays:      z.number().int().min(0).max(365),
});

export const createPtoPolicySchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  description: z.string().max(500).optional(),
  isDefault:   z.boolean().default(false),
  bands:       z.array(ptoPolicyBandSchema).min(1),
});

export const updatePtoPolicySchema = z.object({
  ptoPolicyId: z.string().min(1),
  name:        z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).nullable().optional(),
  isDefault:   z.boolean().optional(),
  isActive:    z.boolean().optional(),
  bands:       z.array(ptoPolicyBandSchema).optional(), // full replace when provided
});

export const assignSitePtoPolicySchema = z.object({
  siteId:      z.string().min(1),
  leaveTypeId: z.string().min(1),
  ptoPolicyId: z.string().min(1).nullable(), // null = clear
});

export const assignEmployeePtoPolicyOverrideSchema = z.object({
  employeeId:  z.string().min(1),
  leaveTypeId: z.string().min(1),
  ptoPolicyId: z.string().min(1).nullable(), // null = clear
});
