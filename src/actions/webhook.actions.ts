"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { TEST_EVENT, WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { canSignFor, currentKeyCheck, endpointSecret, signingReady } from "@/lib/webhooks/signing";
import { checkEndpointUrl, deliveryRule, environmentNote } from "@/lib/webhooks/send";
import { deliverOnce } from "@/lib/webhooks/deliver";

/**
 * Webhooks on Integrations, for company admins (SITE_MANAGE, as API keys).
 * Every read and write is scoped to the admin's company in the where, so an
 * id from another company is simply not found.
 */

const MAX_ENDPOINTS = 10;
const eventsSchema = z
  .array(z.enum(WEBHOOK_EVENTS))
  .min(1, "Choose at least one thing to send.")
  .transform((e) => WEBHOOK_EVENTS.filter((x) => e.includes(x)));
const createSchema = z.object({ name: z.string().trim().min(1, "Enter a name.").max(100), url: z.string().max(2000), events: eventsSchema });
const idSchema = z.object({ id: z.string().min(1).max(64) });
const activeSchema = z.object({ id: z.string().min(1).max(64), active: z.boolean() });

function notFound(): never {
  throw Object.assign(new Error("That webhook was not found. It may have been removed."), { name: "NotFoundError" });
}

function requireTenant(tenantId: string | null): string {
  // A super admin outside any company has no tenantId, and a where with
  // tenantId undefined matches every company's webhooks.
  if (!tenantId) throw new Error("Tenant context required");
  return tenantId;
}

export const listWebhooks = withRBAC("SITE_MANAGE", async ({ tenantId }, _input: void) => {
  const t = requireTenant(tenantId);
  const rows = await db.webhookEndpoint.findMany({
    where: { tenantId: t },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, url: true, events: true, isActive: true, createdAt: true, keyCheck: true,
      deliveries: { orderBy: { attemptedAt: "desc" }, take: 1, select: { ok: true, statusCode: true, attemptedAt: true, event: true } },
    },
  });
  return {
    ready: signingReady(),
    note: environmentNote(),
    endpoints: rows.map(({ keyCheck, deliveries, ...e }) => ({
      ...e,
      sendsHere: canSignFor({ keyCheck }) && deliveryRule(new URL(e.url).hostname).deliverable,
      last: deliveries[0] ?? null,
    })),
  };
});

export const listWebhookDeliveries = withRBAC("SITE_MANAGE", async ({ tenantId }, input: { id: string }) => {
  const t = requireTenant(tenantId);
  const { id } = idSchema.parse(input);
  const endpoint = await db.webhookEndpoint.findFirst({ where: { id, tenantId: t }, select: { id: true } });
  if (!endpoint) notFound();
  return db.webhookDelivery.findMany({
    where: { endpointId: endpoint.id },
    orderBy: { attemptedAt: "desc" },
    take: 25,
    select: { id: true, event: true, attempt: true, ok: true, statusCode: true, response: true, durationMs: true, attemptedAt: true },
  });
});

export const createWebhook = withRBAC(
  "SITE_MANAGE",
  async ({ tenantId, employeeId }, input: { name: string; url: string; events: string[] }) => {
    const t = requireTenant(tenantId);
    const { name, url, events } = createSchema.parse(input);
    const keyCheck = currentKeyCheck();
    if (!keyCheck) throw new Error("Webhooks can't be set up on this server yet: its signing key isn't set.");
    const checked = await checkEndpointUrl(url);
    if ((await db.webhookEndpoint.count({ where: { tenantId: t } })) >= MAX_ENDPOINTS) {
      throw new Error(`A company can have ${MAX_ENDPOINTS} webhooks. Remove one you no longer use first.`);
    }
    const row = await db.webhookEndpoint.create({
      data: { tenantId: t, name, url: checked, events, keyCheck, createdById: employeeId || null },
      select: { id: true, secretVersion: true },
    });
    revalidatePath("/admin/api-keys");
    return { id: row.id, secret: endpointSecret(row.id, row.secretVersion) };
  },
);

export const setWebhookActive = withRBAC("SITE_MANAGE", async ({ tenantId }, input: { id: string; active: boolean }) => {
  const t = requireTenant(tenantId);
  const { id, active } = activeSchema.parse(input);
  const { count } = await db.webhookEndpoint.updateMany({ where: { id, tenantId: t }, data: { isActive: active } });
  if (!count) notFound();
  revalidatePath("/admin/api-keys");
  return { active };
});

export const rotateWebhookSecret = withRBAC("SITE_MANAGE", async ({ tenantId }, input: { id: string }) => {
  const t = requireTenant(tenantId);
  const { id } = idSchema.parse(input);
  const keyCheck = currentKeyCheck();
  if (!keyCheck) throw new Error("Webhooks can't be set up on this server yet: its signing key isn't set.");
  const { count } = await db.webhookEndpoint.updateMany({ where: { id, tenantId: t }, data: { secretVersion: { increment: 1 }, keyCheck } });
  if (!count) notFound();
  const row = await db.webhookEndpoint.findFirst({ where: { id, tenantId: t }, select: { id: true, secretVersion: true } });
  if (!row) notFound();
  revalidatePath("/admin/api-keys");
  return { secret: endpointSecret(row.id, row.secretVersion) };
});

export const removeWebhook = withRBAC("SITE_MANAGE", async ({ tenantId }, input: { id: string }) => {
  const t = requireTenant(tenantId);
  const { id } = idSchema.parse(input);
  // Its waiting messages and its history go with it (ON DELETE CASCADE).
  const { count } = await db.webhookEndpoint.deleteMany({ where: { id, tenantId: t } });
  if (!count) notFound();
  revalidatePath("/admin/api-keys");
  return { removed: true };
});

/** Sends a "webhook.test" message now and says what came back. Paused endpoints can be tested too. */
export const sendWebhookTest = withRBAC("SITE_MANAGE", async ({ tenantId }, input: { id: string }) => {
  const t = requireTenant(tenantId);
  const { id } = idSchema.parse(input);
  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id, tenantId: t },
    select: { id: true, url: true, secretVersion: true, keyCheck: true, tenant: { select: { id: true, name: true } } },
  });
  if (!endpoint) notFound();
  const result = await deliverOnce(endpoint, {
    event: TEST_EVENT,
    occurredAt: new Date(),
    data: { company: endpoint.tenant, message: "A test from CloudTime. Nothing happened to anyone." },
  });
  revalidatePath("/admin/api-keys");
  return { ok: result.ok, held: result.held, statusCode: result.statusCode, response: result.response, durationMs: result.durationMs };
});
