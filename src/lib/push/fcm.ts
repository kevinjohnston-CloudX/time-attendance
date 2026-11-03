import { createSign } from "node:crypto";
import type { PushMessage, SendResult } from "./types";

/**
 * Android phones, through Firebase Cloud Messaging (HTTP v1).
 *
 * <p>FCM_SERVICE_ACCOUNT_JSON holds the Firebase project's service account
 * key, the whole JSON file as one value. Unset or unreadable: nothing is sent,
 * and nothing fails. The access token it trades for lives an hour and is
 * kept until five minutes before then.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };

function account(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    return parsed.project_id && parsed.client_email && parsed.private_key ? (parsed as ServiceAccount) : null;
  } catch {
    return null;
  }
}

export function fcmConfigured(): boolean {
  return account() !== null;
}

let cached: { token: string; until: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const part = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Firebase sign in failed (${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, until: Date.now() + (body.expires_in - 300) * 1000 };
  return body.access_token;
}

export async function sendFcm(token: string, message: PushMessage): Promise<SendResult> {
  const sa = account();
  if (!sa) return "skipped";
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data: { href: message.href },
        android: { priority: "high" },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return "sent";
  // The app was removed or its address replaced: this phone is gone.
  if (res.status === 404) return "gone";
  const text = await res.text().catch(() => "");
  if (text.includes("UNREGISTERED")) return "gone";
  throw new Error(`Firebase refused the message (${res.status})`);
}
