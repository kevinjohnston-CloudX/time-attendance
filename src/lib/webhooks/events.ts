/**
 * What a webhook can be told about. The names are what a receiver sees in the
 * body and in X-Webhook-Event, so they never change once sent; the titles are
 * what Integrations shows.
 */
export const WEBHOOK_EVENTS = ["employee.terminated", "employee.reactivated"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Sent only by Send test, to any endpoint, whatever it listens for. */
export const TEST_EVENT = "webhook.test";

export const EVENT_LABEL: Record<WebhookEvent, { title: string; line: string }> = {
  "employee.terminated": { title: "Employee terminated", line: "When someone is made inactive, with their termination date." },
  "employee.reactivated": { title: "Employee rehired", line: "When someone inactive is made active again." },
};

/** "Terminated and rehired", for a list row. */
export function eventsSummary(events: readonly string[]): string {
  const t = events.includes("employee.terminated");
  const r = events.includes("employee.reactivated");
  return t && r ? "Terminated and rehired" : t ? "Terminated" : r ? "Rehired" : "Nothing";
}
