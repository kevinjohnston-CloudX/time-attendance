import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { currentKeyCheck } from "./signing";
import { deliveryRule } from "./send";
import { deliverOnce } from "./deliver";

/**
 * Sending what is waiting in webhook_queue: straight after the save that
 * queued it, and every minute from /api/cron/dispatch-webhooks for anything
 * that did not get through, as the ticketing system's queue does.
 *
 * <p>A message gets 6 tries. Each one is claimed and its next try booked in
 * one statement (1, 2, 3, 4 and then 5 minutes later), so a run that dies
 * part way simply leaves the message for its next turn, and two runs at once
 * never send the same one (FOR UPDATE SKIP LOCKED). A receiver that refused it
 * on purpose (a 4xx, a redirect, a private address) is not asked again.
 *
 * <p>Only messages this copy of CloudTime may send are claimed: endpoints made
 * under its signing key, on an address it sends to. The rest stay waiting,
 * untouched, for the copy that can.
 */

const MAX_ATTEMPTS = 6;
const BATCH = 25;
const POOL = 5;

type Claimed = { id: string; endpointId: string; event: string; payload: { occurredAt: string; data: unknown }; attempts: number };

export type DrainResult = { claimed: number; delivered: number; failed: number };

/** Sends what is due. With ids, only those messages (the ones a save just queued). */
export async function drainWebhookQueue(opts: { ids?: string[] } = {}): Promise<DrainResult> {
  const none: DrainResult = { claimed: 0, delivered: 0, failed: 0 };
  const check = currentKeyCheck();
  if (!check || (opts.ids && !opts.ids.length)) return none;

  const mine = await db.webhookEndpoint.findMany({ where: { keyCheck: check, isActive: true }, select: { id: true, url: true } });
  const sendable = mine.filter((e) => deliveryRule(new URL(e.url).hostname).deliverable).map((e) => e.id);
  if (!sendable.length) return none;

  const onlyIds = opts.ids ? Prisma.sql`AND q.id = ANY(${opts.ids})` : Prisma.empty;
  const claimed = await db.$queryRaw<Claimed[]>`
    UPDATE webhook_queue
    SET attempts = attempts + 1,
        "nextAttemptAt" = now() + make_interval(mins => LEAST(attempts + 1, 30)),
        "updatedAt" = now()
    WHERE id IN (
      SELECT q.id FROM webhook_queue q
      WHERE q.status = 'PENDING' AND q."nextAttemptAt" <= now()
        AND q."endpointId" = ANY(${sendable})
        ${onlyIds}
      ORDER BY q."nextAttemptAt" ASC
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "endpointId", event, payload, attempts
  `;

  const result: DrainResult = { claimed: claimed.length, delivered: 0, failed: 0 };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(POOL, claimed.length) }, async () => {
      while (next < claimed.length) {
        const row = claimed[next++];
        try {
          const ok = await sendOne(row);
          if (ok) result.delivered++;
          else result.failed++;
        } catch (e) {
          // One message never stops the rest; it stays PENDING for its next try.
          console.error("[webhooks] send failed:", e instanceof Error ? e.message : e);
        }
      }
    }),
  );
  return result;
}

async function sendOne(row: Claimed): Promise<boolean> {
  const endpoint = await db.webhookEndpoint.findUnique({ where: { id: row.endpointId }, select: { id: true, url: true, secretVersion: true, keyCheck: true, isActive: true } });
  if (!endpoint || !endpoint.isActive) {
    // Paused (or removed) since it was queued: what happens while paused is not sent later.
    await db.webhookQueue.updateMany({ where: { id: row.id }, data: { status: "FAILED", lastError: "The webhook was paused before this could be sent." } });
    return false;
  }
  const r = await deliverOnce(endpoint, {
    id: row.id,
    queueId: row.id,
    attempt: row.attempts,
    event: row.event,
    occurredAt: new Date(row.payload.occurredAt),
    data: row.payload.data,
  });
  if (r.ok) {
    await db.webhookQueue.updateMany({ where: { id: row.id }, data: { status: "DELIVERED", deliveredAt: new Date(), lastStatusCode: r.statusCode, lastError: null } });
    return true;
  }
  const giveUp = !r.retryable || row.attempts >= MAX_ATTEMPTS;
  await db.webhookQueue.updateMany({
    where: { id: row.id },
    data: { status: giveUp ? "FAILED" : "PENDING", lastStatusCode: r.statusCode, lastError: r.response?.slice(0, 500) ?? null },
  });
  return false;
}
