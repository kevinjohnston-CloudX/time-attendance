"use server";

import { auth } from "@/lib/auth";
import {
  KnowledgeBaseUnavailable,
  readerAudiences,
  searchKnowledgeBase,
  voteOnKnowledgeBaseArticle,
} from "@/lib/knowledge-base/cxt-kb";

/**
 * Knowledge Base: the two things the page asks for after it has drawn.
 *
 * <p>Who can call these: anyone signed in, on purpose. Reading the knowledge
 * base is not a permission; what each person may read is decided by our
 * ticketing system from the audiences worked out here on the server, never
 * from anything the browser sends, so asking for an HR article as an employee
 * finds nothing.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function searchArticles(q: string): Promise<Result<{ id: string; categoryId: string | null; title: string; excerpt: string | null }[]>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Sign in again to search." };
  try {
    return { success: true, data: await searchKnowledgeBase(await readerAudiences(session.user), String(q ?? "")) };
  } catch (err) {
    if (err instanceof KnowledgeBaseUnavailable) return { success: false, error: "Search isn't available right now. Try again in a minute." };
    throw err;
  }
}

export async function rateArticle(articleId: string, helpful: boolean): Promise<Result<null>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Sign in again to answer." };
  if (typeof helpful !== "boolean" || typeof articleId !== "string") return { success: false, error: "That answer couldn't be read." };
  try {
    const ok = await voteOnKnowledgeBaseArticle(await readerAudiences(session.user), session.user.id, articleId, helpful);
    return ok ? { success: true, data: null } : { success: false, error: "This article is no longer available." };
  } catch (err) {
    if (err instanceof KnowledgeBaseUnavailable) return { success: false, error: "Your answer couldn't be saved. Try again in a minute." };
    throw err;
  }
}
