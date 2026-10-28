"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { API_SCOPES } from "@/lib/api/scopes";

const scopesSchema = z.array(z.enum(API_SCOPES)).max(API_SCOPES.length).transform((s) => API_SCOPES.filter((x) => s.includes(x)));
const createApiKeySchema = z.object({ name: z.string().min(1).max(100), scopes: scopesSchema.default([]) });
const apiKeyIdSchema = z.object({ apiKeyId: z.string().min(1) });
const setScopesSchema = z.object({ apiKeyId: z.string().min(1), scopes: scopesSchema });

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export const listApiKeys = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId }, _input: void) => {
    // A super admin outside any company has no tenantId, and a where with
    // tenantId undefined matches every company's keys.
    if (!tenantId) throw new Error("Tenant context required");
    return db.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, keyPrefix: true, createdAt: true, lastUsedAt: true, isActive: true, scopes: true },
    });
  }
);

export const createApiKey = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId, employeeId }, input: { name: string; scopes?: string[] }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { name, scopes } = createApiKeySchema.parse(input);
    const raw = crypto.randomBytes(32).toString("hex");
    const fullKey = `ta_${raw}`;
    const keyHash = hashKey(fullKey);
    const keyPrefix = `ta_${raw.slice(0, 8)}…`;
    await db.apiKey.create({
      data: { tenantId, name, keyHash, keyPrefix, createdById: employeeId, scopes },
    });
    revalidatePath("/admin/api-keys");
    return { fullKey, keyPrefix };
  }
);

export const revokeApiKey = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId }, input: { apiKeyId: string }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { apiKeyId } = apiKeyIdSchema.parse(input);
    await db.apiKey.update({
      where: { id: apiKeyId, tenantId },
      data: { isActive: false },
    });
    revalidatePath("/admin/api-keys");
  }
);

export const regenerateApiKey = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId }, input: { apiKeyId: string }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { apiKeyId } = apiKeyIdSchema.parse(input);
    const raw = crypto.randomBytes(32).toString("hex");
    const fullKey = `ta_${raw}`;
    const keyHash = hashKey(fullKey);
    const keyPrefix = `ta_${raw.slice(0, 8)}…`;
    await db.apiKey.update({
      where: { id: apiKeyId, tenantId },
      data: { keyHash, keyPrefix, lastUsedAt: null },
    });
    revalidatePath("/admin/api-keys");
    return { fullKey, keyPrefix };
  }
);

/**
 * What a key may read beyond leave types and time off requests. Takes the
 * whole list, so turning one off can never leave another on by accident. A
 * revoked key cannot be changed: it reads nothing either way.
 */
export const setApiKeyScopes = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId }, input: { apiKeyId: string; scopes: string[] }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { apiKeyId, scopes } = setScopesSchema.parse(input);
    const { count } = await db.apiKey.updateMany({
      where: { id: apiKeyId, tenantId, isActive: true },
      data: { scopes },
    });
    if (count === 0) throw new Error("That key was not found, or it has been revoked.");
    revalidatePath("/admin/api-keys");
    return { scopes };
  }
);
