"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, FileText, Folder } from "lucide-react";
import { Button, EmptyState, FilterSelectChip, SearchInput, ToolsBar, ToolsCount } from "@/components/ui";
import { usePhoneLayout } from "@/lib/phone";
import { searchArticles } from "@/actions/knowledge-base.actions";

/**
 * The Knowledge Base library, in the Administration hub's shape: a card of
 * topics with their counts, the search bar, then each section as a group of
 * rows. Rows because the title is what people scan for.
 *
 * <p>Everything listed came from the server already narrowed to what this
 * person may read. Picking a topic narrows that list in place. Searching asks
 * the server, because it also reads the article text and attached files; until
 * its answer arrives the titles and summaries are matched here, so the list
 * reacts while typing.
 */

export type KbTopic = { id: string; name: string; count: number };
export type KbGroup = {
  id: string;
  topicId: string;
  title: string;
  hint: string | null;
  articles: { id: string; title: string; excerpt: string | null }[];
};

export function KnowledgeBaseLibrary({ topics, groups }: { topics: KbTopic[]; groups: KbGroup[] }) {
  const [query, setQuery] = useState("");
  /** null is every topic; a sentinel string could collide with a topic id. */
  const [topic, setTopic] = useState<string | null>(null);
  const [found, setFound] = useState<{ q: string; ids: string[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const phone = usePhoneLayout();
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) {
      setFound(null);
      setSearchError(null);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchArticles(q);
      if (!live) return;
      if (r.success) {
        setFound({ q, ids: r.data.map((a) => a.id) });
        setSearchError(null);
      } else {
        setSearchError(r.error);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const where = useMemo(() => {
    const m = new Map<string, { article: KbGroup["articles"][number]; group: KbGroup }>();
    for (const g of groups) for (const a of g.articles) m.set(a.id, { article: a, group: g });
    return m;
  }, [groups]);

  const total = topics.reduce((n, t) => n + t.count, 0);
  const inTopic = (g: KbGroup) => topic === null || g.topicId === topic;

  // Searching: one ranked list, each row saying where the article sits.
  const results = useMemo(() => {
    if (!q) return null;
    if (found && found.q === q) {
      return found.ids.map((id) => where.get(id)).filter((x): x is NonNullable<typeof x> => !!x && inTopic(x.group));
    }
    const needle = q.toLowerCase();
    return [...where.values()].filter(
      (x) => inTopic(x.group) && `${x.article.title} ${x.article.excerpt ?? ""} ${x.group.title}`.toLowerCase().includes(needle),
    );
    // inTopic reads topic, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, found, where, topic]);

  // The server's answer for what is typed hasn't arrived yet. Until it has,
  // "nothing matches" would be a guess from the titles alone.
  const searching = q.length >= 2 && !searchError && (!found || found.q !== q);
  const shownGroups = groups.filter(inTopic);
  const shown = results ? results.length : shownGroups.reduce((n, g) => n + g.articles.length, 0);

  if (total === 0) {
    return (
      <div className="ta-card rounded-xl">
        <EmptyState
          icon={<BookOpen className="h-8 w-8" />}
          title="No articles yet"
          body="Guides shared with your role appear here."
        />
      </div>
    );
  }

  const choices: { key: string | null; label: string; count: number; icon: React.ReactNode }[] = [
    { key: null, label: "All articles", count: total, icon: <BookOpen className="h-[18px] w-[18px]" /> },
    ...topics.map((t) => ({ key: t.id, label: t.name, count: t.count, icon: <Folder className="h-[18px] w-[18px]" /> })),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* A phone picks the topic in the Filters sheet instead (below). With a
          single topic there is nothing to choose between. */}
      {topics.length > 1 && (
        <section className="ta-phone-hide ta-card flex flex-col gap-2.5 rounded-xl p-4">
          <span className="wms-overline">Topics</span>
          <div className="grid gap-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
            {choices.map((c) => {
              const active = c.key === topic;
              return (
                <button
                  key={c.key ?? "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTopic(c.key)}
                  className="ta-hoverable flex items-center gap-2.5 rounded-lg px-3 py-2 text-left"
                  data-active={active ? "true" : undefined}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    background: active ? "var(--wms-color-primary-50)" : "transparent",
                    color: active ? "var(--text-accent)" : "var(--text-primary)",
                    font: "var(--type-body1)",
                    fontWeight: active ? "var(--weight-semibold)" : "var(--weight-medium)",
                  }}
                >
                  <span className="inline-flex flex-none" style={{ color: active ? "var(--icon-accent)" : "var(--icon-tertiary)" }}>
                    {c.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="tabular flex-none" style={{ font: "var(--type-body2)", color: active ? "var(--text-accent)" : "var(--text-tertiary)" }}>
                    {c.count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <ToolsBar
        search={<SearchInput value={query} onValueChange={setQuery} placeholder="Search articles" width={320} />}
        end={<ToolsCount>{shown} {shown === 1 ? "article" : "articles"}</ToolsCount>}
      >
        {phone && topics.length > 1 && (
          <FilterSelectChip
            label="Topic"
            value={topic ?? ""}
            options={topics.map((t) => ({ id: t.id, name: t.name }))}
            onChange={(v) => setTopic(v || null)}
            allLabel="All topics"
          />
        )}
      </ToolsBar>

      {searchError && (
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
          {searchError} Matching titles only.
        </p>
      )}

      {shown === 0 && searching ? (
        <div className="ta-card rounded-xl" aria-busy="true">
          <EmptyState title="Searching the articles" body="Looking through the text of every guide you can read." />
        </div>
      ) : shown === 0 ? (
        <div className="ta-card rounded-xl">
          <EmptyState
            title="Nothing matches that search"
            body="Try a shorter word, like “punch” or “leave”."
            action={
              <Button
                hierarchy="secondary"
                onClick={() => {
                  setQuery("");
                  setTopic(null);
                }}
              >
                Show all articles
              </Button>
            }
          />
        </div>
      ) : results ? (
        <Rows items={results.map((r) => ({ ...r.article, where: r.group.title }))} />
      ) : (
        shownGroups.map((group) => (
          <section key={group.id} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>{group.title}</h2>
              <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                {group.articles.length} {group.articles.length === 1 ? "article" : "articles"}
              </span>
              {group.hint && (
                <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>{group.hint}</span>
              )}
            </div>
            <Rows items={group.articles} />
          </section>
        ))
      )}
    </div>
  );
}

/** Article rows, hairlines between them the way the hub draws its groups. */
function Rows({ items }: { items: { id: string; title: string; excerpt: string | null; where?: string }[] }) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl"
      style={{ gap: 1, background: "var(--stroke-divider)", border: "1px solid var(--stroke-secondary)" }}
    >
      {items.map((a) => (
        <Link
          key={a.id}
          href={`/knowledge-base/${a.id}`}
          className="ta-hoverable grid items-center gap-x-3.5 gap-y-2 px-4 py-3 [grid-template-columns:32px_minmax(0,1fr)_18px]"
          style={{ background: "var(--surface-card)", color: "var(--text-primary)", textDecoration: "none" }}
        >
          <span
            className="inline-flex items-center justify-center self-start"
            style={{ width: 32, height: 32, borderRadius: 9, background: "var(--wms-color-primary-50)", color: "var(--icon-accent)" }}
          >
            <FileText className="h-[17px] w-[17px]" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)" }}>{a.title}</span>
            {(a.where || a.excerpt) && (
              <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                {a.where && <span style={{ color: "var(--text-tertiary)" }}>{a.where}{a.excerpt ? " · " : ""}</span>}
                {a.excerpt}
              </span>
            )}
          </span>
          <ChevronRight className="h-[17px] w-[17px] flex-none" style={{ color: "var(--icon-tertiary)" }} />
        </Link>
      ))}
    </div>
  );
}
