"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobTitle, deleteJobTitle } from "@/actions/job-title.actions";
import { JobTitleFields } from "@/classic/components/admin/job-titles-manager";

const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls = "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

interface Props {
  jobTitle: {
    id: string;
    name: string;
    externalId: string | null;
    isActive: boolean;
  };
}

export function EditJobTitleClient({ jobTitle }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateJobTitle({
        id: jobTitle.id,
        name: (fd.get("name") as string).trim(),
        externalId: (fd.get("externalId") as string).trim() || undefined,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      router.push("/admin/site-settings?tab=job-titles");
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteJobTitle({ id: jobTitle.id });
      if (!result.success) { setError((result as { success: false; error: string }).error); setConfirmDelete(false); return; }
      router.push("/admin/site-settings?tab=job-titles");
    });
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      <form onSubmit={handleSave}>
        <JobTitleFields initial={jobTitle} mode="edit" />
        <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save changes"}</button>
            <button type="button" onClick={() => router.push("/admin/site-settings?tab=job-titles")} className={cancelBtnCls}>Cancel</button>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Are you sure?</span>
              <button type="button" onClick={handleDelete} disabled={isPending} className={dangerBtnCls}>{isPending ? "Deleting…" : "Yes, delete"}</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={cancelBtnCls}>Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs text-red-500 hover:underline dark:text-red-400">Delete job title</button>
          )}
        </div>
      </form>
    </div>
  );
}
