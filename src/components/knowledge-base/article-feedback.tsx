"use client";

import { useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui";
import { rateArticle } from "@/actions/knowledge-base.actions";

/**
 * "Was this helpful?" under an article. One answer per person: answering
 * again changes it. The answer is kept in our ticketing system, beside the
 * article, where its authors read it.
 *
 * <p>The chosen answer is a selection, not an action, so it stays neutral
 * (DESIGN.md: blue is for buttons that do something) and shows as pressed.
 */
export function ArticleFeedback({ articleId, initial }: { articleId: string; initial: boolean | null }) {
  const [vote, setVote] = useState<boolean | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function answer(helpful: boolean) {
    if (pending || vote === helpful) return;
    const before = vote;
    setVote(helpful);
    setError(null);
    start(async () => {
      const r = await rateArticle(articleId, helpful);
      if (!r.success) {
        setVote(before);
        setError(r.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
        {vote === null ? "Was this helpful?" : "Thanks for letting us know."}
      </span>
      <div className="flex items-center gap-2" role="group" aria-label="Was this helpful?">
        <Button
          hierarchy="secondary"
          size="sm"
          aria-pressed={vote === true}
          data-active={vote === true ? "true" : undefined}
          leadingIcon={<ThumbsUp className="h-4 w-4" />}
          onClick={() => answer(true)}
          style={vote === true ? { background: "var(--fill-pressed)" } : undefined}
        >
          Yes
        </Button>
        <Button
          hierarchy="secondary"
          size="sm"
          aria-pressed={vote === false}
          data-active={vote === false ? "true" : undefined}
          leadingIcon={<ThumbsDown className="h-4 w-4" />}
          onClick={() => answer(false)}
          style={vote === false ? { background: "var(--fill-pressed)" } : undefined}
        >
          No
        </Button>
      </div>
      {error && <span style={{ font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</span>}
    </div>
  );
}
