import crypto from "node:crypto";
import { db } from "@/lib/db";
import { canSignFor, endpointSecret, signatureHeader } from "./signing";
import { postWebhook, type SendResult } from "./send";

type Endpoint = { id: string; url: string; secretVersion: number; keyCheck: string };

/**
 * One attempt to tell an endpoint something: the body built, signed with the
 * endpoint's secret, sent, and the attempt written to webhook_deliveries.
 *
 * <p>The body is the same shape for every event:
 * `{ id, event, occurredAt, data }`. `id` is the same on every try of one
 * message (and sent as X-Webhook-Id), so a receiver that already acted on it
 * can skip a repeat.
 */
export async function deliverOnce(
  endpoint: Endpoint,
  message: { id?: string; event: string; occurredAt: Date; data: unknown; queueId?: string; attempt?: number },
): Promise<SendResult & { held: boolean }> {
  if (!canSignFor(endpoint)) {
    // Made under another copy's signing key: not this server's to send.
    return { ok: false, held: true, statusCode: null, response: "This endpoint was made on another copy of CloudTime, which sends its messages.", durationMs: 0, retryable: true };
  }
  const id = message.id ?? message.queueId ?? `evt_${crypto.randomBytes(12).toString("hex")}`;
  const attempt = message.attempt ?? 1;
  const body = JSON.stringify({ id, event: message.event, occurredAt: message.occurredAt.toISOString(), data: message.data });
  const result = await postWebhook(endpoint.url, body, {
    "X-Webhook-Event": message.event,
    "X-Webhook-Id": id,
    "X-Webhook-Attempt": String(attempt),
    "X-Webhook-Signature": signatureHeader(endpointSecret(endpoint.id, endpoint.secretVersion), body),
  });
  await db.webhookDelivery
    .create({
      data: {
        endpointId: endpoint.id,
        queueId: message.queueId ?? null,
        event: message.event,
        attempt,
        ok: result.ok,
        statusCode: result.statusCode,
        response: result.response,
        durationMs: result.durationMs,
      },
    })
    .catch(() => {});
  return { ...result, held: false };
}
