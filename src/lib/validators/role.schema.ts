import { z } from "zod";

export const RESOURCES = [
  "punch",
  "timesheet",
  "leave",
  "payroll",
  "employee",
  "rules",
  "site",
  "document",
  "report",
  "audit",
  "role",
] as const;

export const ACTIONS = ["read", "write", "execute"] as const;
export const SCOPES = ["own", "team", "all"] as const;

export type Resource = (typeof RESOURCES)[number];
export type Action = (typeof ACTIONS)[number];
export type Scope = (typeof SCOPES)[number];

export const permissionEntrySchema = z.object({
  resource: z.enum(RESOURCES),
  action: z.enum(ACTIONS),
  scope: z.enum(SCOPES),
});

export type PermissionEntry = z.infer<typeof permissionEntrySchema>;

export const createRoleSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).optional(),
  rank: z.number().int().min(0).max(100).default(0),
  permissions: z.array(permissionEntrySchema),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).optional().nullable(),
  rank: z.number().int().min(0).max(100).optional(),
  permissions: z.array(permissionEntrySchema).optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
