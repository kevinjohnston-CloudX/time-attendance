"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPayCategory } from "@/actions/pay-category.actions";
import { CategoryFields } from "@/classic/components/admin/pay-categories-manager";
import type { PolicyOption, LeaveTypeOption } from "@/classic/components/admin/pay-categories-manager";

const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

interface Props {
  defaultNumber?: number;
  ptoPolicies: PolicyOption[];
  leaveTypes: LeaveTypeOption[];
}

export function CreatePayCategoryClient({ defaultNumber, ptoPolicies, leaveTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const limitLeaveTypes = fd.get("limitLeaveTypes") === "on";
    const availableLeaveTypeIds = fd.getAll("availableLeaveTypeIds") as string[];
    startTransition(async () => {
      const result = await createPayCategory({
        number:                fd.get("number"),
        description:           (fd.get("description") as string) || undefined,
        ptoPolicyIds:          fd.getAll("ptoPolicyIds") as string[],
        limitLeaveTypes,
        availableLeaveTypeIds: limitLeaveTypes ? availableLeaveTypeIds : [],
      });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      router.push("/admin/site-settings?tab=pay-categories");
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
      )}
      <form onSubmit={handleCreate}>
        <CategoryFields
          mode="create"
          defaultNumber={defaultNumber}
          ptoPolicies={ptoPolicies}
          leaveTypes={leaveTypes}
        />
        <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <button type="submit" disabled={isPending} className={saveBtnCls}>
            {isPending ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/site-settings?tab=pay-categories")}
            className={cancelBtnCls}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
