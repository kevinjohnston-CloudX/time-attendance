import { after } from "next/server";
import { db } from "@/lib/db";
import { getPerson } from "@/lib/api/external-people";
import { drainWebhookQueue } from "./dispatch";
import type { WebhookEvent } from "./events";

/**
 * Telling a company's webhooks that one of its people was terminated or
 * rehired. Called after the save that changed it (the employee screen, the
 * ADP sync), never inside it: a webhook can never hold up or undo an HR save.
 *
 * <p>The body carries the person as GET /api/external/people/{id} returns
 * them, read once, now, so every try sends what was true when it happened.
 * Paused webhooks are skipped: nothing is kept for them to send later.
 */

/** What a change of active state means to a receiver, or null when it did not change. */
export function activeChangeEvent(wasActive: boolean, isActive: boolean): WebhookEvent | null {
  if (wasActive && !isActive) return "employee.terminated";
  if (!wasActive && isActive) return "employee.reactivated";
  return null;
}

/** Queues the event for every active webhook of the company that listens for it. Returns the queued ids. */
export async function queueEmployeeEvent(tenantId: string, employeeId: string, event: WebhookEvent): Promise<string[]> {
  try {
    const endpoints = await db.webhookEndpoint.findMany({ where: { tenantId, isActive: true, events: { has: event } }, select: { id: true } });
    if (!endpoints.length) return [];
    const person = await getPerson(tenantId, employeeId);
    if (!person) return [];
    const payload = { occurredAt: new Date().toISOString(), data: { person } };
    const rows = await db.$transaction(
      endpoints.map((e) => db.webhookQueue.create({ data: { tenantId, endpointId: e.id, event, employeeId, payload }, select: { id: true } })),
    );
    return rows.map((r) => r.id);
  } catch (e) {
    // The save already happened; say so loudly rather than fail it.
    console.error("[webhooks] could not queue", event, "for", employeeId, e instanceof Error ? e.message : e);
    return [];
  }
}

/** Sends the given messages once the response has gone; the every minute job retries what fails. */
export function sendSoon(ids: string[]): void {
  if (!ids.length) return;
  after(async () => {
    try {
      await drainWebhookQueue({ ids });
    } catch (e) {
      console.error("[webhooks] send after save failed; the scheduled job will retry:", e instanceof Error ? e.message : e);
    }
  });
}
