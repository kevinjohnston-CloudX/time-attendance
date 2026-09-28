"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateReasonCode, deleteReasonCode } from "@/actions/reason-code.actions";
import { ReasonCodeFields } from "@/components/admin/reason-codes-manager";

const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls = "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

interface Props {
  reasonCode: { id: string; code: string; label: string; color: string | null; isActive: boolean };
}

export function EditReasonCodeClient({ reasonCode }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateReasonCode({
        reasonCodeId: reasonCode.id,
        code: fd.get("code") as string,
        label: fd.get("label") as string,
        color: (fd.get("color") as string) || null,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      router.push("/admin/site-settings?tab=reason-codes");
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteReasonCode({ reasonCodeId: reasonCode.id });
      if (!result.success) { setError((result as { success: false; error: string }).error); setConfirmDelete(false); return; }
      router.push("/admin/site-settings?tab=reason-codes");
    });
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      <form onSubmit={handleSave}>
        <ReasonCodeFields initial={reasonCode} mode="edit" />
        <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save changes"}</button>
            <button type="button" onClick={() => router.push("/admin/site-settings?tab=reason-codes")} className={cancelBtnCls}>Cancel</button>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Are you sure?</span>
              <button type="button" onClick={handleDelete} disabled={isPending} className={dangerBtnCls}>{isPending ? "Deleting…" : "Yes, delete"}</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={cancelBtnCls}>Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs text-red-500 hover:underline dark:text-red-400">Delete code</button>
          )}
        </div>
      </form>
    </div>
  );
}
