import { createSign, randomBytes } from "node:crypto";

/**
 * Every email CloudTime sends goes through here.
 *
 * <p>Two ways out, picked by what the server has:
 * <ul>
 *   <li><b>Google (preferred).</b> A Google service account allowed, by domain
 *       wide delegation, to send as the mailbox in MAIL_FROM_EMAIL (for us
 *       support@cloudxsystems.net). Set GMAIL_SA_KEY to the key JSON, raw or
 *       base64. This is how the ticketing system sends, so no other mail
 *       service is needed. Only the send scope is ever requested.</li>
 *   <li><b>SendGrid.</b> SENDGRID_API_KEY, when no Google key is set.</li>
 * </ul>
 * The sender is MAIL_FROM_EMAIL, or SENDGRID_FROM_EMAIL for servers set up
 * before this existed. With neither way set up, nothing is sent and
 * {@link isEmailConfigured} says so.
 */

export interface MailAttachment {
  filename: string;
  content: Buffer;
  type: string;
}

export interface MailMessage {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: MailAttachment[];
}

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const FROM_NAME = "CloudTime";

function fromEmail(): string | null {
  return process.env.MAIL_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || null;
}

let keyCache: { raw: string; key: { client_email: string; private_key: string } | null } | undefined;
function serviceAccountKey(): { client_email: string; private_key: string } | null {
  const raw = process.env.GMAIL_SA_KEY;
  if (!raw) return null;
  if (keyCache?.raw === raw) return keyCache.key;
  let key: { client_email: string; private_key: string } | null = null;
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(text);
    key = parsed?.client_email && parsed?.private_key ? parsed : null;
  } catch {
    key = null;
  }
  keyCache = { raw, key };
  return key;
}

function provider(): "gmail" | "sendgrid" | null {
  if (!fromEmail()) return null;
  if (serviceAccountKey()) return "gmail";
  if (process.env.SENDGRID_API_KEY) return "sendgrid";
  return null;
}

export function isEmailConfigured(): boolean {
  return provider() !== null;
}

/** Sends one message. Throws when email is not set up or the mail service refuses. */
export async function sendMail(message: MailMessage): Promise<void> {
  const to = message.to.map((s) => s.trim()).filter(Boolean);
  if (!to.length) throw new Error("There is no one to send this email to.");
  const via = provider();
  const from = fromEmail();
  if (!via || !from) throw new Error("Email is not set up on this server, so nothing was sent.");

  if (via === "gmail") {
    await sendViaGmail(from, { ...message, to });
    return;
  }

  const sgMail = (await import("@sendgrid/mail")).default;
  sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  await sgMail.send({
    to,
    from: { email: from, name: FROM_NAME },
    subject: message.subject,
    ...(message.text ? { text: message.text } : {}),
    ...(message.html ? { html: message.html } : {}),
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map((a) => ({
            content: a.content.toString("base64"),
            filename: a.filename,
            type: a.type,
            disposition: "attachment" as const,
          })),
        }
      : {}),
  } as Parameters<typeof sgMail.send>[0]);
}

// ── Google ───────────────────────────────────────────────────────────────────

let tokenCache: { sub: string; token: string; expires: number } | null = null;

async function gmailToken(sub: string): Promise<string> {
  if (tokenCache && tokenCache.sub === sub && tokenCache.expires > Date.now() + 60_000) return tokenCache.token;
  const key = serviceAccountKey();
  if (!key) throw new Error("Email is not set up on this server, so nothing was sent.");

  const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
    "." +
    b64url(
      JSON.stringify({
        iss: key.client_email,
        sub,
        scope: GMAIL_SEND_SCOPE,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    );
  const assertion = `${unsigned}.${b64url(createSign("RSA-SHA256").update(unsigned).sign(key.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google refused to let CloudTime send as ${sub}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { sub, token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function sendViaGmail(from: string, message: MailMessage): Promise<void> {
  const token = await gmailToken(from);
  const raw = buildMimeMessage(from, message).toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google did not send the email: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

/** A header value, encoded only when it carries more than plain ASCII. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Base64 broken into 76 character lines, as mail expects. */
function wrapBase64(buf: Buffer): string {
  return (buf.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

/** The whole message in the form Gmail's send call takes. Exported for tests. */
export function buildMimeMessage(from: string, message: MailMessage): Buffer {
  const boundary = () => `ct_${randomBytes(12).toString("hex")}`;
  const headers = [
    `From: ${encodeHeader(FROM_NAME)} <${from}>`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
  ];

  const textPart = (type: "plain" | "html", body: string) =>
    [`Content-Type: text/${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", wrapBase64(Buffer.from(body, "utf8"))].join("\r\n");

  let body: string;
  const parts: string[] = [];
  if (message.text) parts.push(textPart("plain", message.text));
  if (message.html) parts.push(textPart("html", message.html));
  if (!parts.length) parts.push(textPart("plain", ""));

  if (parts.length === 1) {
    body = parts[0];
  } else {
    const alt = boundary();
    body = [`Content-Type: multipart/alternative; boundary="${alt}"`, "", ...parts.map((p) => `--${alt}\r\n${p}`), `--${alt}--`].join("\r\n");
  }

  const attachments = message.attachments ?? [];
  if (attachments.length) {
    const mixed = boundary();
    const files = attachments.map((a) => {
      const name = encodeHeader(a.filename.replace(/["\r\n]/g, ""));
      return [
        `Content-Type: ${a.type}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(a.content),
      ].join("\r\n");
    });
    body = [`Content-Type: multipart/mixed; boundary="${mixed}"`, "", `--${mixed}\r\n${body}`, ...files.map((f) => `--${mixed}\r\n${f}`), `--${mixed}--`].join("\r\n");
  }

  // The body's first lines are its own Content-Type header, so it follows the
  // top headers directly.
  return Buffer.from(`${headers.join("\r\n")}\r\n${body}\r\n`, "utf8");
}
