"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { updatePayCategory, deletePayCategory } from "@/actions/pay-category.actions";
import { CategoryFields } from "@/components/admin/pay-categories-manager";
import type { CategoryWithPolicies, PolicyOption, LeaveTypeOption } from "@/components/admin/pay-categories-manager";

const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

interface Props {
  category: CategoryWithPolicies;
  ptoPolicies: PolicyOption[];
  leaveTypes: LeaveTypeOption[];
}

export function EditPayCategoryClient({ category, ptoPolicies, leaveTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const limitLeaveTypes = fd.get("limitLeaveTypes") === "on";
    const availableLeaveTypeIds = fd.getAll("availableLeaveTypeIds") as string[];
    startTransition(async () => {
      const result = await updatePayCategory({
        id:                    category.id,
        number:                fd.get("number"),
        description:           (fd.get("description") as string) || undefined,
        isActive:              fd.get("isActive") === "true",
        ptoPolicyIds:          fd.getAll("ptoPolicyIds") as string[],
        limitLeaveTypes,
        availableLeaveTypeIds: limitLeaveTypes ? availableLeaveTypeIds : [],
      });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      router.push("/admin/site-settings?tab=pay-categories");
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deletePayCategory({ id: category.id });
      if (!result.success) { setError((result as { success: false; error: string }).error); setConfirmDelete(false); return; }
      router.push("/admin/site-settings?tab=pay-categories");
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
      )}
      <form onSubmit={handleSave}>
        <CategoryFields
          initial={category}
          mode="edit"
          ptoPolicies={ptoPolicies}
          leaveTypes={leaveTypes}
        />
        <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/admin/site-settings?tab=pay-categories")}
              className={cancelBtnCls}
            >
              Cancel
            </button>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Are you sure?</span>
              <button type="button" onClick={handleDelete} disabled={isPending} className={dangerBtnCls}>
                {isPending ? "Deleting…" : "Yes, delete"}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={cancelBtnCls}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:underline dark:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete category
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
