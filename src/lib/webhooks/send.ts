import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Sending one webhook: the address checked before a byte leaves, a ten second
 * limit, no redirects followed, and a plain answer about what happened.
 *
 * <p>An endpoint is an address an admin typed, and the server is the one that
 * calls it, so it must never reach anything private: our own machine, the
 * office network, or the cloud's metadata service. The address is checked when
 * the endpoint is saved and again on every send, at the moment the connection
 * resolves it, so a name that later points somewhere private is refused too.
 *
 * <p>Only live sends to any public address. Every other copy of CloudTime
 * (a laptop, a preview) shares the live database, so it sends only to the
 * hosts named in WEBHOOK_ALLOW_HOSTS, as the ticketing system's staging does,
 * and may reach those even on a private address (a receiver running locally).
 */

const TIMEOUT_MS = 10_000;
const MAX_URL = 2000;

const BLOCKED = new net.BlockList();
for (const [net4, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED.addSubnet(net4, bits, "ipv4");
for (const [net6, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) BLOCKED.addSubnet(net6, bits, "ipv6");

/** A private, local or reserved address, including an IPv4 one written as IPv6. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return BLOCKED.check(mapped, "ipv4");
  const family = net.isIP(address);
  return family === 0 || BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

function isLive(): boolean {
  return process.env.VERCEL_ENV ? process.env.VERCEL_ENV === "production" : process.env.NODE_ENV === "production";
}

function allowedHosts(): string[] {
  return (process.env.WEBHOOK_ALLOW_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** Whether this copy of CloudTime would send to a host, and if not, why, in words for the screen. */
export function deliveryRule(host: string): { deliverable: boolean; reason: string | null } {
  if (isLive()) return { deliverable: true, reason: null };
  const hosts = allowedHosts();
  if (hosts.includes(host.toLowerCase())) return { deliverable: true, reason: null };
  return {
    deliverable: false,
    reason: hosts.length
      ? `This copy of CloudTime only sends to ${hosts.join(", ")}. Live sends to any public address.`
      : "This copy of CloudTime doesn't send webhooks. Live does.",
  };
}

/** One line for Integrations about where this copy sends, or null on live. */
export function environmentNote(): string | null {
  if (isLive()) return null;
  const hosts = allowedHosts();
  return hosts.length ? `This copy of CloudTime only sends to ${hosts.join(", ")}.` : "This copy of CloudTime doesn't send webhooks. Live does.";
}

/**
 * The address as an admin typed it, checked: https, no user name or password
 * in it, not private. Throws a sentence the screen can show.
 */
export async function checkEndpointUrl(raw: string): Promise<string> {
  const text = raw.trim();
  if (!text || text.length > MAX_URL) throw new Error("Enter the full web address the other system gave you, starting with https://.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("That isn't a web address. Enter the full address, starting with https://.");
  }
  const allowed = !isLive() && allowedHosts().includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(allowed && url.protocol === "http:")) throw new Error("The address must start with https://.");
  if (url.username || url.password) throw new Error("Take the user name and password out of the address. CloudTime signs every message instead.");
  url.hash = "";
  if (!allowed) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = net.isIP(host) ? [host] : await dns.promises.lookup(host, { all: true }).then((a) => a.map((x) => x.address), () => []);
    if (!addresses.length) throw new Error(`${url.hostname} can't be found. Check the address.`);
    if (addresses.some(isPrivateAddress)) throw new Error("That address points inside a private network, which CloudTime never calls.");
  }
  return url.toString();
}

/** Resolves a host for the connection itself and refuses a private answer. */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error("The address points inside a private network."), { code: "EPRIVATE" }), "", 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export type SendResult = {
  ok: boolean;
  statusCode: number | null;
  /** The receiver's answer, or why it was not reached, cut to 500 characters. */
  response: string | null;
  durationMs: number;
  /** Worth trying again later: no answer, a timeout, a 5xx, 408 or 429. */
  retryable: boolean;
};

/** POSTs one body. Never throws: every failure comes back as a result. */
export async function postWebhook(rawUrl: string, body: string, headers: Record<string, string>): Promise<SendResult> {
  const started = Date.now();
  const done = (r: Omit<SendResult, "durationMs">): SendResult => ({ ...r, response: r.response?.slice(0, 500) ?? null, durationMs: Date.now() - started });

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return done({ ok: false, statusCode: null, response: "The saved address isn't a web address.", retryable: false });
  }
  const rule = deliveryRule(url.hostname);
  if (!rule.deliverable) return done({ ok: false, statusCode: null, response: rule.reason, retryable: false });
  const trusted = !isLive() && allowedHosts().includes(url.hostname.toLowerCase());
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (!trusted && net.isIP(literal) && isPrivateAddress(literal)) {
    return done({ ok: false, statusCode: null, response: "The address points inside a private network.", retryable: false });
  }

  return new Promise<SendResult>((resolve) => {
    const mod = url.protocol === "http:" ? http : https;
    const req = mod.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "CloudTime-Webhooks/1.0", ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        lookup: trusted ? undefined : guardedLookup,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (text.length < 2000) text += chunk;
        });
        res.on("end", () => {
          clearTimeout(timer);
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            return resolve(done({ ok: false, statusCode: status, response: "The address answered with a redirect, which CloudTime doesn't follow. Use the final address.", retryable: false }));
          }
          const ok = status >= 200 && status < 300;
          resolve(done({ ok, statusCode: status, response: text || null, retryable: !ok && (status >= 500 || status === 408 || status === 429) }));
        });
        res.on("error", () => {});
      },
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("No answer within 10 seconds."), { code: "ETIMEDOUT" })), TIMEOUT_MS);
    req.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const why =
        e.code === "EPRIVATE" ? "The address points inside a private network."
        : e.code === "ETIMEDOUT" ? "No answer within 10 seconds."
        : e.code === "ENOTFOUND" ? `${url.hostname} can't be found.`
        : e.code === "ECONNREFUSED" ? "The receiver refused the connection."
        : `Couldn't reach the receiver (${e.code ?? e.message}).`;
      resolve(done({ ok: false, statusCode: null, response: why, retryable: e.code !== "EPRIVATE" }));
    });
    req.end(body);
  });
}
