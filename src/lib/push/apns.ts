import { connect } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";
import type { PushMessage, SendResult } from "./types";

/**
 * iPhones, through Apple's push service, signed with a key from the Apple
 * developer account (Certificates, Identifiers & Profiles, Keys).
 *
 * <p>APNS_KEY is the .p8 file's text, APNS_KEY_ID and APNS_TEAM_ID name it.
 * APNS_SANDBOX=true sends to apps built from Xcode rather than the store.
 * Any of them unset: nothing is sent to iPhones, and nothing fails.
 */

const TOPIC = "net.cloudxsystems.cloudtime";

function settings() {
  const key = process.env.APNS_KEY;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!key || !keyId || !teamId) return null;
  const host = process.env.APNS_SANDBOX === "true" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  return { key: key.replace(/\\n/g, "\n"), keyId, teamId, host };
}

export function apnsConfigured(): boolean {
  return settings() !== null;
}

// Apple wants the same signed token reused for up to an hour, not one per message.
let cached: { token: string; until: number } | null = null;

function providerToken(s: NonNullable<ReturnType<typeof settings>>): string {
  if (cached && cached.until > Date.now()) return cached.token;
  const part = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${part({ alg: "ES256", kid: s.keyId })}.${part({ iss: s.teamId, iat: Math.floor(Date.now() / 1000) })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: createPrivateKey(s.key), dsaEncoding: "ieee-p1363" }).toString("base64url");
  cached = { token: `${unsigned}.${signature}`, until: Date.now() + 50 * 60 * 1000 };
  return cached.token;
}

export async function sendApns(token: string, message: PushMessage): Promise<SendResult> {
  const s = settings();
  if (!s) return "skipped";
  const body = JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: "default" }, href: message.href });

  const { status, reason } = await new Promise<{ status: number; reason: string }>((resolve, reject) => {
    const client = connect(s.host);
    const fail = (e: unknown) => {
      client.close();
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    client.on("error", fail);
    client.setTimeout(10_000, () => fail(new Error("Apple did not answer in time")));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${providerToken(s)}`,
      "apns-topic": TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let code = 0;
    let text = "";
    req.on("response", (headers) => (code = Number(headers[":status"])));
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      client.close();
      let why = "";
      try {
        why = (JSON.parse(text) as { reason?: string }).reason ?? "";
      } catch {}
      resolve({ status: code, reason: why });
    });
    req.on("error", fail);
    req.end(body);
  });

  if (status === 200) return "sent";
  // The app was removed, or this address belongs to another build of it.
  if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") return "gone";
  throw new Error(`Apple refused the message (${status} ${reason})`);
}
