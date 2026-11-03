import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendApns } from "./apns";
import { sendFcm } from "./fcm";

const message = { title: "Time off approved", body: "Your time off request was approved.", href: "/leave" };

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

function firebaseAccount() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    project_id: "cloudtime-test",
    client_email: "push@cloudtime-test.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
}

describe("phone notifications before they are set up", () => {
  it("sends nothing to Android without the Firebase key, and does not fail", async () => {
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await sendFcm("token", message)).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats an unreadable Firebase key as not set up", async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = "{not json";
    expect(await sendFcm("token", message)).toBe("skipped");
  });

  it("sends nothing to iPhones without the Apple key, and does not fail", async () => {
    delete process.env.APNS_KEY;
    expect(await sendApns("token", message)).toBe("skipped");
  });
});

describe("Android through Firebase", () => {
  it("signs in, then sends the title, text and page to open", async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = firebaseAccount();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    expect(await sendFcm("phone-1", message)).toBe("sent");
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("https://fcm.googleapis.com/v1/projects/cloudtime-test/messages:send");
    expect(JSON.parse(init.body).message).toMatchObject({ token: "phone-1", notification: { title: message.title }, data: { href: "/leave" } });
  });

  it("reports a phone that no longer has the app as gone", async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = firebaseAccount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"status":"NOT_FOUND"}}', { status: 404 })));
    expect(await sendFcm("old-phone", message)).toBe("gone");
  });
});
