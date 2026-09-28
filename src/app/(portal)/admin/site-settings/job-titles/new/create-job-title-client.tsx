"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createJobTitle } from "@/actions/job-title.actions";
import { JobTitleFields } from "@/components/admin/job-titles-manager";

const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

export function CreateJobTitleClient() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createJobTitle({
        name: (fd.get("name") as string).trim(),
        externalId: (fd.get("externalId") as string).trim() || undefined,
      });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      router.push("/admin/site-settings?tab=job-titles");
    });
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      <form onSubmit={handleCreate}>
        <JobTitleFields mode="create" />
        <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create job title"}</button>
          <button type="button" onClick={() => router.push("/admin/site-settings?tab=job-titles")} className={cancelBtnCls}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
