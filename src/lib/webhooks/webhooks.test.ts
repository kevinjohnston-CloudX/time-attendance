import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { created } = vi.hoisted(() => ({ created: [] as unknown[] }));
vi.mock("@/lib/db", () => ({ db: { webhookDelivery: { create: async (a: { data: unknown }) => created.push(a.data) } } }));

process.env.WEBHOOK_SIGNING_KEY = "ab".repeat(32);
process.env.WEBHOOK_ALLOW_HOSTS = "127.0.0.1";

import { canSignFor, currentKeyCheck, endpointSecret, signatureHeader } from "./signing";
import { checkEndpointUrl, deliveryRule, isPrivateAddress, postWebhook } from "./send";
import { deliverOnce } from "./deliver";

describe("signing", () => {
  it("derives a stable secret per endpoint and version, and a new one per version", () => {
    expect(endpointSecret("e1", 1)).toBe(endpointSecret("e1", 1));
    expect(endpointSecret("e1", 2)).not.toBe(endpointSecret("e1", 1));
    expect(endpointSecret("e2", 1)).not.toBe(endpointSecret("e1", 1));
    expect(endpointSecret("e1", 1)).toMatch(/^whsec_[0-9a-f]{64}$/);
  });

  it("signs only for endpoints made under this server's key", () => {
    expect(canSignFor({ keyCheck: currentKeyCheck()! })).toBe(true);
    expect(canSignFor({ keyCheck: "0000000000000000" })).toBe(false);
  });

  it("signs the raw body as the ticketing system does", () => {
    const expected = crypto.createHmac("sha256", "s3cret").update('{"a":1}').digest("hex");
    expect(signatureHeader("s3cret", '{"a":1}')).toBe(`sha256=${expected}`);
  });
});

describe("addresses", () => {
  it("knows private, local and reserved addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "nonsense"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "52.1.2.3", "2606:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });

  it("refuses addresses that are not https, carry a password, or point inside", async () => {
    await expect(checkEndpointUrl("http://example.com/hook")).rejects.toThrow("https://");
    await expect(checkEndpointUrl("https://user:pw@example.com/hook")).rejects.toThrow("user name and password");
    await expect(checkEndpointUrl("https://10.0.0.5/hook")).rejects.toThrow("private network");
    await expect(checkEndpointUrl("https://[::1]/hook")).rejects.toThrow("private network");
    await expect(checkEndpointUrl("not a url")).rejects.toThrow("isn't a web address");
  });

  it("lets a copy that is not live send only to its allowed hosts", async () => {
    expect(deliveryRule("127.0.0.1").deliverable).toBe(true);
    expect(deliveryRule("cxt.cloudxsystems.net")).toMatchObject({ deliverable: false });
    await expect(checkEndpointUrl("http://127.0.0.1:3100/api/x#frag")).resolves.toBe("http://127.0.0.1:3100/api/x");
  });
});

describe("sending", () => {
  let server: http.Server;
  let base = "";
  const seen: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ headers: req.headers, body });
        if (req.url === "/fail") return res.writeHead(503).end("busy");
        if (req.url === "/move") return res.writeHead(302, { Location: "/ok" }).end();
        res.writeHead(200).end("thanks");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("sends a signed body the receiver can check, and logs the attempt", async () => {
    const endpoint = { id: "e1", url: `${base}/ok`, secretVersion: 1, keyCheck: currentKeyCheck()! };
    const r = await deliverOnce(endpoint, { event: "webhook.test", occurredAt: new Date("2026-10-28T18:00:00Z"), data: { hello: 1 } });
    expect(r).toMatchObject({ ok: true, held: false, statusCode: 200, response: "thanks" });
    const got = seen.at(-1)!;
    const mac = crypto.createHmac("sha256", endpointSecret("e1", 1)).update(got.body).digest("hex");
    expect(got.headers["x-webhook-signature"]).toBe(`sha256=${mac}`);
    expect(got.headers["x-webhook-event"]).toBe("webhook.test");
    expect(JSON.parse(got.body)).toMatchObject({ event: "webhook.test", occurredAt: "2026-10-28T18:00:00.000Z", data: { hello: 1 } });
    expect(JSON.parse(got.body).id).toBe(got.headers["x-webhook-id"]);
    expect(created.at(-1)).toMatchObject({ endpointId: "e1", ok: true, statusCode: 200 });
  });

  it("holds an endpoint made under another key, without sending", async () => {
    const before = seen.length;
    const r = await deliverOnce({ id: "e9", url: `${base}/ok`, secretVersion: 1, keyCheck: "ffffffffffffffff" }, { event: "webhook.test", occurredAt: new Date(), data: {} });
    expect(r).toMatchObject({ ok: false, held: true });
    expect(seen.length).toBe(before);
  });

  it("marks a 5xx worth retrying and a redirect not", async () => {
    expect(await postWebhook(`${base}/fail`, "{}", {})).toMatchObject({ ok: false, statusCode: 503, retryable: true });
    expect(await postWebhook(`${base}/move`, "{}", {})).toMatchObject({ ok: false, statusCode: 302, retryable: false });
  });

  it("refuses a host this copy may not send to", async () => {
    expect(await postWebhook("https://cxt.cloudxsystems.net/hook", "{}", {})).toMatchObject({ ok: false, statusCode: null, retryable: false });
  });
});
