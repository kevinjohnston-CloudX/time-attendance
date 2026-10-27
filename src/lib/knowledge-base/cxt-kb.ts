import { db } from "@/lib/db";
import { mailAddress } from "@/lib/email-address";
import { getEffectiveRole, userHasPermission, validViewAsId } from "@/lib/rbac/check-permission";
import { isLiveAttendanceOnly } from "@/lib/rbac/permission-resolver";
import { isValidRole } from "@/lib/rbac/roles";

/**
 * The Knowledge Base page's line to our ticketing system (CXT), where the
 * articles live and are written. CloudTime keeps no copy: it asks CXT for what
 * this person may read, shows it, and tells CXT when they open an article or
 * answer "Was this helpful?". Authors choose in CXT which articles show here
 * and for whom.
 *
 * <p>Same connection as Help &amp; feedback (CXT_SUPPORT_URL, CXT_SUPPORT_KEY),
 * called from this server only (it reads the database, so it can never be
 * bundled for a browser), and the key never reaches one. With
 * either unset the page says the library isn't connected and nothing is sent.
 *
 * <p>Who sees what is decided by CXT. This file only says which of CXT's
 * CloudTime audiences the person is in, from the permissions they actually
 * hold, so a custom role or "view as" lands in the right place.
 */

type Conn = { url: string; key: string };

function connection(): Conn | null {
  const url = (process.env.CXT_SUPPORT_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.CXT_SUPPORT_KEY ?? "").trim();
  return url && key ? { url, key } : null;
}

export function knowledgeBaseConnected(): boolean {
  return !!connection();
}

type SessionUser = { id?: string; role: string; customRoleId?: string | null; canViewAs?: boolean; isActive?: boolean };

/**
 * CXT's CloudTime audiences this person is in. Everyone is in "everyone";
 * the rest follow what the person can do here, as "View as" shows it:
 * - supervisors approve their team's timesheets or leave;
 * - payroll manages pay periods; HR manages employees;
 * - admins are system administrators (CXT then shows them every guide);
 * - agency sees a team's punches or timecards but approves nothing;
 * - lossPrevention is on a role limited to Live Attendance.
 */
export async function readerAudiences(user: SessionUser): Promise<string[]> {
  const viewAsId = await validViewAsId(user);
  // The role whose limits apply right now: the one being viewed as, else
  // their own. An old-style View as names a built-in role, which is never
  // limited to Live Attendance.
  const roleId = viewAsId ? (isValidRole(viewAsId) ? null : viewAsId) : (user.customRoleId ?? null);
  const [approveTime, approveLeave, payroll, hr, teamPunches, teamTimecards, role, liveOnly] = await Promise.all([
    userHasPermission(user, "TIMESHEET_APPROVE_TEAM"),
    userHasPermission(user, "LEAVE_APPROVE_TEAM"),
    userHasPermission(user, "PAY_PERIOD_MANAGE"),
    userHasPermission(user, "EMPLOYEE_MANAGE"),
    userHasPermission(user, "PUNCH_VIEW_TEAM"),
    userHasPermission(user, "TIMECARD_VIEW_TEAM"),
    getEffectiveRole(user),
    isLiveAttendanceOnly(roleId).catch(() => false),
  ]);
  const approves = approveTime || approveLeave;
  const out = ["everyone"];
  if (approves) out.push("supervisors");
  if (payroll) out.push("payroll");
  if (hr) out.push("hr");
  if (role === "SYSTEM_ADMIN" || role === "SUPER_ADMIN") out.push("admins");
  if ((teamPunches || teamTimecards) && !approves) out.push("agency");
  if (liveOnly) out.push("lossPrevention");
  return out;
}

export type KbCategory = { id: string; parentId: string | null; name: string; description: string | null; order: number };
export type KbArticleRow = { id: string; categoryId: string | null; title: string; excerpt: string | null; position: number; updatedAt: string };
export type KbTree = { categories: KbCategory[]; articles: KbArticleRow[] };
export type KbArticle = {
  id: string;
  categoryId: string | null;
  title: string;
  excerpt: string | null;
  html: string;
  pdfUrl: string | null;
  publishedAt: string | null;
  updatedAt: string;
  myVote: boolean | null;
};

export class KnowledgeBaseUnavailable extends Error {}

// A short memory of what CXT answered, per audience set, so a person paging
// through articles doesn't make each page wait on a second server. CXT holds
// its own 30-second view as well, so an author's change shows within a minute.
const TREE_MS = 60_000;
const memo = new Map<string, { at: number; value: unknown }>();

async function call<T>(
  path: string,
  audiences: string[],
  init: { method?: "GET" | "POST"; reader?: { id: string; email: string | null; name: string | null }; body?: unknown } = {},
): Promise<{ status: number; data: T | null }> {
  const conn = connection();
  if (!conn) throw new KnowledgeBaseUnavailable("not connected");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${conn.key}`,
    "X-Reader-Audiences": audiences.join(","),
  };
  if (init.reader) {
    headers["X-Reader-Id"] = init.reader.id;
    if (init.reader.email) headers["X-Reader-Email"] = init.reader.email;
    // Header values are Latin-1; a name with other characters is left off
    // rather than breaking the request. CXT still has the address.
    if (init.reader.name && /^[\x20-\x7e -ÿ]*$/.test(init.reader.name)) headers["X-Reader-Name"] = init.reader.name;
  }
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const res = await fetch(`${conn.url}/api/kb-channel/cloudtime${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.status === 404) return { status: 404, data: null };
    if (res.status === 204) return { status: 204, data: null };
    if (!res.ok) {
      console.error("[knowledge-base] CXT answered", res.status, path);
      throw new KnowledgeBaseUnavailable(`status ${res.status}`);
    }
    return { status: res.status, data: (await res.json()) as T };
  } catch (err) {
    if (err instanceof KnowledgeBaseUnavailable) throw err;
    console.error("[knowledge-base] CXT unreachable", path, err);
    throw new KnowledgeBaseUnavailable("unreachable");
  }
}

/** Every article this person may read, without bodies, with their categories. */
export async function getKnowledgeBaseTree(audiences: string[]): Promise<KbTree> {
  const key = `tree:${audiences.join(",")}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TREE_MS) return hit.value as KbTree;
  const { data } = await call<KbTree>("", audiences);
  const value: KbTree = { categories: data?.categories ?? [], articles: data?.articles ?? [] };
  memo.set(key, { at: Date.now(), value });
  return value;
}

/** The person's articles that match, best first (title, text and attached files). */
export async function searchKnowledgeBase(audiences: string[], q: string): Promise<Pick<KbArticleRow, "id" | "categoryId" | "title" | "excerpt">[]> {
  const query = q.trim().slice(0, 200);
  if (query.length < 2) return [];
  const { data } = await call<{ results: Pick<KbArticleRow, "id" | "categoryId" | "title" | "excerpt">[] }>(
    `/search?q=${encodeURIComponent(query)}`,
    audiences,
  );
  return data?.results ?? [];
}

/** Name and address for CXT's record of who read and who answered. */
async function readerOf(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, workEmail: true } });
  return { id: userId, email: u ? mailAddress(u) : null, name: u?.name ?? null };
}

/** One article, or null when it doesn't exist or isn't this person's to read.
 *  Not cached: it carries this person's own answer and short-lived file links. */
export async function getKnowledgeBaseArticle(audiences: string[], userId: string, articleId: string): Promise<KbArticle | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(articleId)) return null;
  const { data } = await call<KbArticle>(`/articles/${articleId}`, audiences, { reader: { id: userId, email: null, name: null } });
  return data;
}

/** Tell CXT the person opened the article. Never fails the page. */
export async function recordKnowledgeBaseView(audiences: string[], userId: string, articleId: string): Promise<void> {
  try {
    await call(`/articles/${articleId}/view`, audiences, { method: "POST", reader: await readerOf(userId) });
  } catch {
    // A view that couldn't be recorded is a missing count, not a broken page.
  }
}

/** Record the person's "Was this helpful?" answer. False when CXT refused it. */
export async function voteOnKnowledgeBaseArticle(audiences: string[], userId: string, articleId: string, helpful: boolean): Promise<boolean> {
  const { status } = await call(`/articles/${articleId}/vote`, audiences, {
    method: "POST",
    reader: await readerOf(userId),
    body: { helpful },
  });
  return status === 204;
}
