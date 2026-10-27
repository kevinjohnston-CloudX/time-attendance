import { after } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, CloudOff, FileText, FileX } from "lucide-react";
import { format } from "date-fns";
import { auth } from "@/lib/auth";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import {
  KnowledgeBaseUnavailable,
  getKnowledgeBaseArticle,
  getKnowledgeBaseTree,
  knowledgeBaseConnected,
  readerAudiences,
  recordKnowledgeBaseView,
} from "@/lib/knowledge-base/cxt-kb";
import { cleanArticleHtml } from "@/lib/knowledge-base/clean-article";
import { ArticleFeedback } from "@/components/knowledge-base/article-feedback";
import styles from "@/components/knowledge-base/article.module.css";

/**
 * One Knowledge Base article, read only. It is written and edited in our
 * ticketing system (CXT); this page draws what CXT sends, cleaned first (see
 * clean-article.ts), tells CXT the person read it, and asks whether it helped.
 *
 * <p>An article this person may not read answers exactly like one that does
 * not exist, so the page never confirms that an HR guide is there.
 */

export const dynamic = "force-dynamic";

export default async function KnowledgeBaseArticlePage({ params }: { params: Promise<{ articleId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { articleId } = await params;
  const back = (
    <LinkButton href="/knowledge-base" hierarchy="secondary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
      All articles
    </LinkButton>
  );

  const missing = (title: string, body: string, icon: React.ReactNode) => (
    <div className="flex flex-col gap-4">
      <PageHeader pinned title="Knowledge Base" actions={back} />
      <Card padding={0}>
        <EmptyState icon={icon} title={title} body={body} />
      </Card>
    </div>
  );

  if (!knowledgeBaseConnected()) {
    return missing("The Knowledge Base isn't connected", "Guides appear here once CloudTime is connected to the ticketing system.", <CloudOff className="h-8 w-8" />);
  }

  const audiences = await readerAudiences(session.user);
  let article, tree;
  try {
    [article, tree] = await Promise.all([
      getKnowledgeBaseArticle(audiences, session.user.id, articleId),
      getKnowledgeBaseTree(audiences),
    ]);
  } catch (err) {
    if (!(err instanceof KnowledgeBaseUnavailable)) throw err;
    return missing("The Knowledge Base can't be reached", "This guide couldn't be loaded just now. Try again in a minute.", <CloudOff className="h-8 w-8" />);
  }
  if (!article) {
    return missing("This article isn't available", "It may have been moved or removed, or it isn't shared with your role.", <FileX className="h-8 w-8" />);
  }

  // Counted once the page is on its way, so a slow answer from CXT never
  // holds up the article.
  const userId = session.user.id;
  after(() => recordKnowledgeBaseView(audiences, userId, article.id));

  const byId = new Map(tree.categories.map((c) => [c.id, c]));
  const section = article.categoryId ? byId.get(article.categoryId) : undefined;
  const topic = section?.parentId ? byId.get(section.parentId) : undefined;
  const place = [topic?.name, section?.name].filter(Boolean).join(" · ");
  const more = tree.articles
    .filter((a) => a.categoryId === article.categoryId && a.id !== article.id)
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned title={article.title} subtitle={place || undefined} actions={back} />

      <Card padding={0}>
        <article className={styles.article}>
          {article.pdfUrl && (
            <p className={styles.pdf}>
              <a href={article.pdfUrl} target="_blank" rel="noopener noreferrer">
                <FileText className="h-4 w-4" aria-hidden />
                Open this guide as a PDF
              </a>
            </p>
          )}
          <div dangerouslySetInnerHTML={{ __html: cleanArticleHtml(article.html) }} />
        </article>
        <div className={styles.foot}>
          <ArticleFeedback articleId={article.id} initial={article.myVote} />
          <span className={styles.updated}>Updated {format(new Date(article.updatedAt), "MMM d, yyyy")}</span>
        </div>
      </Card>

      {more.length > 0 && section && (
        <section className="flex flex-col gap-2.5">
          <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>More in {section.name}</h2>
          <div
            className="flex flex-col overflow-hidden rounded-xl"
            style={{ gap: 1, background: "var(--stroke-divider)", border: "1px solid var(--stroke-secondary)" }}
          >
            {more.map((a) => (
              <Link
                key={a.id}
                href={`/knowledge-base/${a.id}`}
                className="ta-hoverable flex items-center gap-3 px-4 py-2.5"
                style={{ background: "var(--surface-card)", color: "var(--text-primary)", textDecoration: "none", font: "var(--type-body1)" }}
              >
                <FileText className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
                <ChevronRight className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
