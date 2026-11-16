import { db } from "@/lib/db";
import { isEmailConfigured, sendMail } from "@/lib/email/send-mail";

/**
 * The email beside each approval notification: the same event as the phone
 * alert (lib/push/leave-alerts.ts, punch-alerts.ts), for the people who do
 * not have the app or are at a computer.
 *
 * <p>Unlike a lock screen, an inbox is the person's own, so the email carries
 * the details a decision needs (who, which dates, which punch) and a button
 * straight to the screen where it is made.
 *
 * <p>Each person gets their own email, so no one sees who else was told. It
 * goes to the work email first, the personal one otherwise, and to no one
 * when the record has neither. Never throws: an email that does not go out
 * must never undo or fail the approval that caused it.
 */

export type ApprovalEmail = {
  subject: string;
  heading: string;
  line: string;
  /** Label and value rows, in order. Values are escaped here. */
  details?: [string, string][];
  button: string;
  /** The CloudTime page the button opens, as a path ("/supervisor/leave"). */
  href: string;
};

/** Where CloudTime answers, for the links in an email. */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const set = env.AUTH_URL || env.NEXTAUTH_URL || env.APP_URL;
  const base = set || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return base.replace(/\/+$/, "");
}

/** Names and notes are typed by people, so they are escaped before they go into HTML. */
function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// CloudTime's own colors (src/styles/wms/colors.css), as hex: mail clients
// do not read CSS variables.
const INK = "#111827";
const MUTED = "#4b5563";
const QUIET = "#6b7280";
const LINE = "#e2e4e9";
const CANVAS = "#eeeff2";
const WELL = "#f9fafb";
const ACCENT = "#2563eb";

export function approvalEmailHtml(m: ApprovalEmail, base: string): string {
  const url = `${base}${m.href}`;
  const rows = (m.details ?? [])
    .map(
      ([label, value], i) => `
              <tr>
                <td style="padding:10px 16px;font-size:14px;line-height:20px;color:${QUIET};white-space:nowrap;vertical-align:top;${i ? `border-top:1px solid ${LINE};` : ""}">${esc(label)}</td>
                <td style="padding:10px 16px;font-size:14px;line-height:20px;color:${INK};font-weight:600;text-align:right;${i ? `border-top:1px solid ${LINE};` : ""}">${esc(value)}</td>
              </tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
    <div style="font-size:14px;line-height:20px;font-weight:600;color:${INK};margin:0 0 12px 4px;">CloudTime</div>
    <div style="background:#ffffff;border:1px solid ${LINE};border-radius:14px;padding:28px 24px;">
      <h1 style="margin:0 0 6px;font-size:20px;line-height:28px;font-weight:600;color:${INK};">${esc(m.heading)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:22px;color:${MUTED};">${esc(m.line)}</p>${
        rows
          ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;background:${WELL};border:1px solid ${LINE};border-radius:10px;margin:0 0 24px;">${rows}
      </table>`
          : ""
      }
      <a href="${esc(url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:600;padding:12px 20px;border-radius:8px;">${esc(m.button)}</a>
    </div>
    <p style="margin:16px 4px 0;font-size:12px;line-height:18px;color:${QUIET};">This is an automated email from CloudTime. Replies are not read.</p>
  </div>
</body>
</html>`;
}

export function approvalEmailText(m: ApprovalEmail, base: string): string {
  const details = (m.details ?? []).map(([label, value]) => `${label}: ${value}`).join("\n");
  return [m.heading, "", m.line, ...(details ? ["", details] : []), "", `${m.button}: ${base}${m.href}`, "", "This is an automated email from CloudTime. Replies are not read."].join("\n");
}

/**
 * An address no mail can ever reach: the reserved test endings (RFC 2606 and
 * 6761) the Demo and Sandbox companies use. Sending there only bounces back
 * to the support mailbox.
 */
export function undeliverable(address: string): boolean {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  return !domain || /\.(test|example|invalid|localhost)$/.test(domain) || /(^|\.)example\.(com|net|org)$/.test(domain);
}

/** Sends the email to each of these people on their own. */
export async function emailUsers(userIds: string[], m: ApprovalEmail): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0 || !isEmailConfigured()) return;
  try {
    const people = await db.user.findMany({ where: { id: { in: ids } }, select: { workEmail: true, email: true } });
    const base = appBaseUrl();
    const html = approvalEmailHtml(m, base);
    const text = approvalEmailText(m, base);
    await Promise.all(
      people.map(async (p) => {
        const to = (p.workEmail || p.email || "").trim();
        if (!to || undeliverable(to)) return;
        try {
          await sendMail({ to: [to], subject: m.subject, html, text });
        } catch (e) {
          console.error("[approval email] not sent:", e instanceof Error ? e.message : e);
        }
      }),
    );
  } catch (e) {
    console.error("[approval email] skipped:", e instanceof Error ? e.message : e);
  }
}

/** "Thu, Nov 20" or "Nov 20 – Nov 24": a request's days, read as stored (calendar dates). */
export function leaveDays(start: Date, end: Date): string {
  const day = (d: Date, weekday: boolean) =>
    d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(weekday ? { weekday: "short" } : {}) });
  const same = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  return same ? day(start, true) : `${day(start, false)} – ${day(end, false)}`;
}

/** "8 hours", "1 hour", "7.5 hours"; null when the request holds none. */
export function leaveHours(seconds: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const h = Math.round((seconds / 3600) * 100) / 100;
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

/** "Thu, Nov 13, 5:02 PM", on the person's own clock. */
export function punchMoment(at: Date, timeZone: string): string {
  return at.toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}
