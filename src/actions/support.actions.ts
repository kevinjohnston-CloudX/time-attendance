"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { mailAddress } from "@/lib/email-address";
import { ROLE_LABEL } from "@/components/layout/nav-model";
import { SUPPORT_LIMITS, supportRequestSchema } from "@/lib/validators/support.schema";

/**
 * Help & feedback: a request from anyone signed in to CloudTime, sent to the
 * CloudTime Support queue in our ticketing system (CXT).
 *
 * <p>Who can call this: anyone signed in, on purpose. Asking for help is not a
 * permission, and the request carries nothing but what the person typed and
 * who they are. Wall screens (live attendance only) don't draw the button, but
 * nothing about them makes a request from that account harmful.
 *
 * <p>Who the request is from is read here, from the database, never from the
 * browser: the address replies go to (work email first, else the personal
 * one), the name, and the company, site, department and role they work in.
 * The browser only sends what was written and which page it was on.
 *
 * <p>CXT does the rest: it files the ticket under that address and emails a
 * confirmation from support@cloudxsystems.net, which is where the person
 * follows up. The call goes from this server with CloudTime's own key
 * (CXT_SUPPORT_URL, CXT_SUPPORT_KEY), and with neither set nothing is sent.
 */

type Who = {
  email: string | null;
  name: string | null;
  role: string | null;
  employeeCode: string | null;
  company: string | null;
  site: string | null;
  department: string | null;
};

async function whoIsAsking(userId: string, sessionTenantId: string | null): Promise<Who | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      workEmail: true,
      employee: {
        select: {
          employeeCode: true,
          role: true,
          customRole: { select: { name: true } },
          tenant: { select: { name: true } },
          site: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
  });
  if (!user) return null;
  const emp = user.employee;
  // Someone with no employee record (a super admin) still belongs to a company.
  const company =
    emp?.tenant?.name ??
    (sessionTenantId
      ? (await db.tenant.findUnique({ where: { id: sessionTenantId }, select: { name: true } }))?.name ?? null
      : null);
  return {
    email: mailAddress(user),
    name: user.name ?? null,
    role: emp?.customRole?.name ?? (emp?.role ? ROLE_LABEL[emp.role] ?? emp.role : null),
    employeeCode: emp?.employeeCode ?? null,
    company,
    site: emp?.site?.name ?? null,
    department: emp?.department?.name ?? null,
  };
}

function connection(): { url: string; key: string } | null {
  const url = (process.env.CXT_SUPPORT_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.CXT_SUPPORT_KEY ?? "").trim();
  return url && key ? { url, key } : null;
}

/** What the window shows before anything is sent: where the answer will go,
 *  and whether requests can be sent from here at all. */
export async function getSupportRequestContext(): Promise<
  | { success: true; data: { email: string | null; name: string | null; company: string | null; available: boolean } }
  | { success: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Sign in again to send a request." };
  const who = await whoIsAsking(session.user.id, session.user.tenantId ?? null);
  if (!who) return { success: false, error: "Sign in again to send a request." };
  return {
    success: true,
    data: { email: who.email, name: who.name, company: who.company, available: !!connection() },
  };
}

export async function sendSupportRequest(
  formData: FormData,
): Promise<
  | { success: true; data: { ticketNumber: string; confirmationTo: string; confirmationSent: boolean } }
  | { success: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Sign in again to send a request." };

  const conn = connection();
  if (!conn) return { success: false, error: "Requests can't be sent from here yet. Email support@cloudxsystems.net instead." };

  let fields: unknown;
  try {
    fields = JSON.parse(String(formData.get("request") ?? ""));
  } catch {
    return { success: false, error: "The request could not be read. Try again." };
  }
  const parsed = supportRequestSchema.safeParse(fields);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the request and try again." };
  const input = parsed.data;

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > SUPPORT_LIMITS.files) return { success: false, error: `Attach at most ${SUPPORT_LIMITS.files} files.` };
  const total = files.reduce((n, f) => n + f.size, 0) + input.html.length;
  if (total > SUPPORT_LIMITS.totalBytes) {
    return { success: false, error: "The files and screenshots are over 9 MB together. Remove some and try again." };
  }

  const who = await whoIsAsking(session.user.id, session.user.tenantId ?? null);
  if (!who) return { success: false, error: "Sign in again to send a request." };
  if (!who.email) {
    return { success: false, error: "Your account has no email address, so we couldn't reply. Ask your administrator to add one." };
  }

  const body = new FormData();
  body.append(
    "payload",
    JSON.stringify({
      requestType: input.requestType,
      impact: input.impact,
      subject: input.subject,
      html: input.html,
      text: input.text,
      reporter: { email: who.email, name: who.name, role: who.role, employeeCode: who.employeeCode },
      context: {
        company: who.company,
        site: who.site,
        department: who.department,
        pagePath: input.pagePath,
        pageLabel: input.pageLabel,
        appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      },
    }),
  );
  for (const f of files) body.append("files", f, f.name);

  try {
    const res = await fetch(`${conn.url}/api/webhooks/cloudtime-support`, {
      method: "POST",
      headers: { Authorization: `Bearer ${conn.key}` },
      body,
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
    const out = (await res.json().catch(() => null)) as {
      ticketNumber?: unknown;
      confirmationTo?: unknown;
      confirmationSent?: unknown;
      message?: unknown;
      error?: unknown;
    } | null;
    if (res.status === 201 && out?.ticketNumber) {
      return {
        success: true,
        data: {
          ticketNumber: String(out.ticketNumber),
          confirmationTo: String(out.confirmationTo ?? who.email),
          confirmationSent: !!out.confirmationSent,
        },
      };
    }
    // A request that didn't validate says why, in words meant for the person.
    if (res.status === 400 || res.status === 413 || res.status === 429) {
      return { success: false, error: String(out?.message ?? "The request wasn't accepted. Check it and try again.") };
    }
    console.error("[support] CXT answered", res.status, out?.error ?? "");
    return { success: false, error: "Support couldn't be reached. Try again in a minute, or email support@cloudxsystems.net." };
  } catch (err) {
    console.error("[support] CXT unreachable", err);
    return { success: false, error: "Support couldn't be reached. Try again in a minute, or email support@cloudxsystems.net." };
  }
}
