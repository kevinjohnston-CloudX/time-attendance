"use client";

import { useState, useTransition } from "react";
import { resolveException } from "@/actions/supervisor.actions";

interface Props {
  exceptionId: string;
}

export function ResolveExceptionForm({ exceptionId }: Props) {
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    startTransition(async () => {
      const result = await resolveException({ exceptionId, resolution: note });
      if (!result.success) alert(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Resolution note…"
        className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      />
      <button
        type="submit"
        disabled={isPending || !note.trim()}
        className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-900 disabled:opacity-50 dark:bg-zinc-600 dark:hover:bg-zinc-500"
      >
        {isPending ? "Saving…" : "Resolve"}
      </button>
    </form>
  );
}
