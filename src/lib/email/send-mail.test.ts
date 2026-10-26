import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { buildMimeMessage, isEmailConfigured, sendMail } from "./send-mail";

const ENV_KEYS = ["GMAIL_SA_KEY", "MAIL_FROM_EMAIL", "SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"] as const;
const saved: Record<string, string | undefined> = {};

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA_KEY = JSON.stringify({
  client_email: "cloudtime@test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("isEmailConfigured", () => {
  it("is off with nothing set", () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it("is off with a Google key but no sender", () => {
    process.env.GMAIL_SA_KEY = SA_KEY;
    expect(isEmailConfigured()).toBe(false);
  });

  it("is on with a Google key and a sender, raw or base64", () => {
    process.env.MAIL_FROM_EMAIL = "support@example.com";
    process.env.GMAIL_SA_KEY = SA_KEY;
    expect(isEmailConfigured()).toBe(true);
    process.env.GMAIL_SA_KEY = Buffer.from(SA_KEY).toString("base64");
    expect(isEmailConfigured()).toBe(true);
  });

  it("is off when the Google key cannot be read", () => {
    process.env.MAIL_FROM_EMAIL = "support@example.com";
    process.env.GMAIL_SA_KEY = "not a key";
    expect(isEmailConfigured()).toBe(false);
  });

  it("still works with the SendGrid settings alone", () => {
    process.env.SENDGRID_API_KEY = "SG.x";
    process.env.SENDGRID_FROM_EMAIL = "support@example.com";
    expect(isEmailConfigured()).toBe(true);
  });
});

describe("sendMail through Google", () => {
  it("asks only for the send scope, as the sender, and posts the message", async () => {
    process.env.MAIL_FROM_EMAIL = "support@example.com";
    process.env.GMAIL_SA_KEY = SA_KEY;
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ url, body: init.body });
        if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
        return new Response("{}");
      })
    );

    await sendMail({ to: ["a@example.com", " b@example.com "], subject: "Report", html: "<p>Hi</p>" });

    const claim = JSON.parse(
      Buffer.from(new URLSearchParams(calls[0].body).get("assertion")!.split(".")[1], "base64url").toString()
    );
    expect(claim.sub).toBe("support@example.com");
    expect(claim.scope).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(calls[1].url).toContain("/gmail/v1/users/me/messages/send");
    const raw = Buffer.from(JSON.parse(calls[1].body).raw, "base64url").toString();
    expect(raw).toContain("To: a@example.com, b@example.com");
  });

  it("throws when Google refuses, so a failed send is never recorded as sent", async () => {
    process.env.MAIL_FROM_EMAIL = "support@example.com";
    process.env.GMAIL_SA_KEY = SA_KEY;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    await expect(sendMail({ to: ["a@example.com"], subject: "x", text: "y" })).rejects.toThrow(/403/);
  });

  it("throws when email is not set up", async () => {
    await expect(sendMail({ to: ["a@example.com"], subject: "x", text: "y" })).rejects.toThrow(/not set up/);
  });
});

describe("buildMimeMessage", () => {
  it("carries the sender, the subject, the body and the attachment", () => {
    const csv = Buffer.from("FIRSTNAME,LASTNAME\r\nAna,Pérez\r\n", "utf8");
    const mime = buildMimeMessage("support@example.com", {
      to: ["a@example.com"],
      subject: "CloudTime Security scan report, Oct 25, 2026",
      html: "<p>Attached</p>",
      attachments: [{ filename: "CloudTime-Security-scan-report-2026-10-25.csv", content: csv, type: "text/csv" }],
    }).toString();

    expect(mime).toContain("From: CloudTime <support@example.com>");
    expect(mime).toContain("Subject: CloudTime Security scan report, Oct 25, 2026");
    expect(mime).toContain("multipart/mixed");
    expect(mime).toContain('filename="CloudTime-Security-scan-report-2026-10-25.csv"');
    expect(mime).toContain(csv.toString("base64"));
  });

  it("encodes a subject that is not plain ASCII", () => {
    const mime = buildMimeMessage("s@example.com", { to: ["a@example.com"], subject: "Reporte de García", text: "x" }).toString();
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from("Reporte de García").toString("base64")}?=`);
  });
});
