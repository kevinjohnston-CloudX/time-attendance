import { beforeEach, describe, expect, it, vi } from "vitest";

let users: { workEmail: string | null; email: string | null }[] = [];
let configured = true;
const mails: { to: string[]; subject: string; html?: string; text?: string }[] = [];

vi.mock("@/lib/db", () => ({ db: { user: { findMany: async () => users } } }));
vi.mock("@/lib/email/send-mail", () => ({
  isEmailConfigured: () => configured,
  sendMail: async (m: { to: string[]; subject: string; html?: string; text?: string }) => {
    if (m.to[0] === "broken@x.com") throw new Error("refused");
    mails.push(m);
  },
}));

import { appBaseUrl, approvalEmailHtml, emailUsers, leaveDays, leaveHours, punchMoment, type ApprovalEmail } from "./approval-email";

const message: ApprovalEmail = {
  subject: "Time off request from Maria <b>Lopez</b>",
  heading: "Time off request",
  line: "Maria asked for time off.",
  details: [["Employee", "Maria <script>"]],
  button: "Review request",
  href: "/supervisor/leave",
};

describe("approval emails", () => {
  beforeEach(() => {
    users = [];
    configured = true;
    mails.length = 0;
  });

  it("sends each person their own email, to the work address first", async () => {
    users = [
      { workEmail: "sup@company.com", email: "sup@gmail.com" },
      { workEmail: null, email: "hr@gmail.com" },
      { workEmail: null, email: null },
      { workEmail: "robin@cloudtime-demo.test", email: null },
    ];
    await emailUsers(["a", "b", "c", "d"], message);
    expect(mails.map((m) => m.to)).toEqual([["sup@company.com"], ["hr@gmail.com"]]);
  });

  it("never fails the approval when email is off or a send is refused", async () => {
    configured = false;
    users = [{ workEmail: "sup@company.com", email: null }];
    await emailUsers(["a"], message);
    expect(mails).toEqual([]);

    configured = true;
    users = [{ workEmail: "broken@x.com", email: null }, { workEmail: "ok@x.com", email: null }];
    await expect(emailUsers(["a", "b"], message)).resolves.toBeUndefined();
    expect(mails.map((m) => m.to)).toEqual([["ok@x.com"]]);
  });

  it("escapes what people typed and links to the live site", () => {
    const html = approvalEmailHtml(message, "https://time.example.com");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Maria &lt;script&gt;");
    expect(html).toContain('href="https://time.example.com/supervisor/leave"');
  });

  it("finds the site's address from the server settings", () => {
    expect(appBaseUrl({ AUTH_URL: "http://127.0.0.1:3000/" } as unknown as NodeJS.ProcessEnv)).toBe("http://127.0.0.1:3000");
    expect(appBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "time.example.com" } as unknown as NodeJS.ProcessEnv)).toBe("https://time.example.com");
  });

  it("writes days, hours and times the way people read them", () => {
    expect(leaveDays(new Date("2026-11-20T00:00:00Z"), new Date("2026-11-20T00:00:00Z"))).toBe("Fri, Nov 20");
    expect(leaveDays(new Date("2026-11-20T00:00:00Z"), new Date("2026-11-24T00:00:00Z"))).toBe("Nov 20 – Nov 24");
    expect(leaveHours(8 * 3600)).toBe("8 hours");
    expect(leaveHours(3600)).toBe("1 hour");
    expect(leaveHours(27000)).toBe("7.5 hours");
    expect(leaveHours(0)).toBeNull();
    expect(punchMoment(new Date("2026-11-13T22:02:00Z"), "America/Los_Angeles")).toBe("Fri, Nov 13, 2:02 PM");
  });
});
