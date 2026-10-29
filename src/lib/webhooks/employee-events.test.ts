import { describe, expect, it, vi } from "vitest";

const { endpoints, created, person, later } = vi.hoisted(() => ({
  endpoints: [] as { id: string }[],
  created: [] as Record<string, unknown>[],
  person: { value: { id: "emp1", name: "Jane Doe", status: "inactive" } as Record<string, unknown> | null },
  later: [] as (() => Promise<void>)[],
}));
vi.mock("@/lib/db", () => ({
  db: {
    webhookEndpoint: { findMany: async () => endpoints },
    webhookQueue: { create: (a: { data: Record<string, unknown> }) => (created.push(a.data), { id: `q${created.length}` }) },
    $transaction: async (ops: unknown[]) => ops,
  },
}));
vi.mock("@/lib/api/external-people", () => ({ getPerson: async () => person.value }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => later.push(fn) }));
const drain = vi.fn(async (_opts?: unknown) => ({ claimed: 0, delivered: 0, failed: 0 }));
vi.mock("./dispatch", () => ({ drainWebhookQueue: (o: unknown) => drain(o) }));

import { activeChangeEvent, queueEmployeeEvent, sendSoon } from "./employee-events";

describe("activeChangeEvent", () => {
  it("names a termination and a rehire, and nothing else", () => {
    expect(activeChangeEvent(true, false)).toBe("employee.terminated");
    expect(activeChangeEvent(false, true)).toBe("employee.reactivated");
    expect(activeChangeEvent(true, true)).toBeNull();
    expect(activeChangeEvent(false, false)).toBeNull();
  });
});

describe("queueEmployeeEvent", () => {
  it("queues nothing when no active webhook listens", async () => {
    endpoints.length = 0;
    expect(await queueEmployeeEvent("t1", "emp1", "employee.terminated")).toEqual([]);
    expect(created).toHaveLength(0);
  });

  it("queues one message per webhook, with the person as they are now", async () => {
    endpoints.splice(0, endpoints.length, { id: "w1" }, { id: "w2" });
    const ids = await queueEmployeeEvent("t1", "emp1", "employee.terminated");
    expect(ids).toEqual(["q1", "q2"]);
    expect(created.map((c) => c.endpointId)).toEqual(["w1", "w2"]);
    expect(created[0]).toMatchObject({ tenantId: "t1", event: "employee.terminated", employeeId: "emp1", payload: { data: { person: person.value } } });
  });

  it("never throws into the save that called it", async () => {
    person.value = null;
    expect(await queueEmployeeEvent("t1", "gone", "employee.terminated")).toEqual([]);
  });
});

describe("sendSoon", () => {
  it("sends only the queued ids, after the response", async () => {
    sendSoon([]);
    expect(later).toHaveLength(0);
    sendSoon(["q1", "q2"]);
    expect(drain).not.toHaveBeenCalled();
    await later[0]();
    expect(drain).toHaveBeenCalledWith({ ids: ["q1", "q2"] });
  });
});
