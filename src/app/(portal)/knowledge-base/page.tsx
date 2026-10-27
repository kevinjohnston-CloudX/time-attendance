import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { BookOpen, CloudOff } from "lucide-react";
import {
  KnowledgeBaseUnavailable,
  getKnowledgeBaseTree,
  knowledgeBaseConnected,
  readerAudiences,
  type KbTree,
} from "@/lib/knowledge-base/cxt-kb";
import { KnowledgeBaseLibrary, type KbGroup, type KbTopic } from "@/components/knowledge-base/library";

/**
 * Knowledge Base: how-to guides for CloudTime, read only.
 *
 * <p>The articles are written and kept in our ticketing system (CXT), where
 * the authors also choose which of them show here and for whom. This page
 * holds no copy: it asks CXT for the articles this person may read and draws
 * them in the Administration hub's shape (topics, then sections of rows),
 * because a library is the same job as a hub: find the one you want by name.
 *
 * <p>Open to everyone signed in, on purpose. Which articles each person sees
 * is decided by CXT from the audiences worked out on this server.
 */

export const dynamic = "force-dynamic";

/** Topics are the top-level categories; each section is a group under one. */
function shape(tree: KbTree): { topics: KbTopic[]; groups: KbGroup[] } {
  const byParent = new Map<string | null, KbTree["categories"]>();
  for (const c of tree.categories) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  const ordered = (list: KbTree["categories"] = []) =>
    [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const articlesIn = (categoryId: string) =>
    tree.articles
      .filter((a) => a.categoryId === categoryId)
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
      .map(({ id, title, excerpt }) => ({ id, title, excerpt }));

  const topics: KbTopic[] = [];
  const groups: KbGroup[] = [];
  for (const top of ordered(byParent.get(null))) {
    const own = articlesIn(top.id);
    const sections = ordered(byParent.get(top.id)).map((s) => ({ section: s, articles: articlesIn(s.id) }));
    const count = own.length + sections.reduce((n, s) => n + s.articles.length, 0);
    if (count === 0) continue;
    topics.push({ id: top.id, name: top.name, count });
    if (own.length) groups.push({ id: top.id, topicId: top.id, title: top.name, hint: top.description, articles: own });
    for (const s of sections) {
      if (s.articles.length) {
        groups.push({ id: s.section.id, topicId: top.id, title: s.section.name, hint: s.section.description, articles: s.articles });
      }
    }
  }
  return { topics, groups };
}

export default async function KnowledgeBasePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const header = <PageHeader pinned title="Knowledge Base" subtitle="How-to guides for CloudTime" />;

  if (!knowledgeBaseConnected()) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card padding={0}>
          <EmptyState
            icon={<BookOpen className="h-8 w-8" />}
            title="The Knowledge Base isn't connected"
            body="Guides appear here once CloudTime is connected to the ticketing system."
          />
        </Card>
      </div>
    );
  }

  let tree: KbTree;
  try {
    tree = await getKnowledgeBaseTree(await readerAudiences(session.user));
  } catch (err) {
    if (!(err instanceof KnowledgeBaseUnavailable)) throw err;
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card padding={0}>
          <EmptyState
            icon={<CloudOff className="h-8 w-8" />}
            title="The Knowledge Base can't be reached"
            body="The guides couldn't be loaded just now. Try again in a minute."
          />
        </Card>
      </div>
    );
  }

  const { topics, groups } = shape(tree);
  return (
    <div className="flex flex-col gap-4">
      {header}
      <KnowledgeBaseLibrary topics={topics} groups={groups} />
    </div>
  );
}
