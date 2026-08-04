"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";

const createApiKeySchema = z.object({ name: z.string().min(1).max(100) });
const apiKeyIdSchema = z.object({ apiKeyId: z.string().min(1) });

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export const listApiKeys = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId }, _input: void) => {
    return db.apiKey.findMany({
      where: { tenantId: tenantId! },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, keyPrefix: true, createdAt: true, lastUsedAt: true, isActive: true },
    });
  }
);

export const createApiKey = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId, employeeId }, input: { name: string }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const { name } = createApiKeySchema.parse(input);
    const raw = crypto.randomBytes(32).toString("hex");
    const fullKey = `ta_${raw}`;
    const keyHash = hashKey(fullKey);
    const keyPrefix = `ta_${raw.slice(0, 8)}…`;
    await db.apiKey.create({
      data: { tenantId, name, keyHash, keyPrefix, createdById: employeeId },
    });
    revalidatePath("/admin/api-keys");
    return { fullKey, keyPrefix };
  }
);

export const revokeApiKey = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId }, input: { apiKeyId: string }) => {
    const { apiKeyId } = apiKeyIdSchema.parse(input);
    await db.apiKey.update({
      where: { id: apiKeyId, tenantId: tenantId! },
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
