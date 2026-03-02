import { z } from "zod";

export const createTenantSchema = z.object({
  name: z.string().min(1, "Tenant name is required"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens")
    .transform((v) => v.toLowerCase()),
  siteName: z.string().min(1, "Site name is required"),
  siteTimezone: z.string().min(1).default("America/New_York"),
  adminName: z.string().min(1, "Admin name is required"),
  adminUsername: z.string().min(3, "Username must be at least 3 characters"),
  adminPassword: z.string().min(8, "Password must be at least 8 characters"),
  adminEmployeeCode: z.string().min(1, "Employee code is required"),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
