"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRuleSet, deleteRuleSet } from "@/actions/admin.actions";
import { RuleSetFields, parseForm } from "@/components/admin/rule-sets-manager";
import type { RuleSet } from "@prisma/client";

const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls = "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

interface Props {
  ruleSet: RuleSet;
  payCodes: { id: string; code: number; label: string }[];
}

export function EditRuleSetClient({ ruleSet, payCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateRuleSet({ ruleSetId: ruleSet.id, ...parseForm(new FormData(e.currentTarget)) });
      if (!result.success) { setError(result.error); return; }
      router.push("/admin/rules-setup?tab=rule-sets");
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteRuleSet({ ruleSetId: ruleSet.id });
      if (!result.success) { setError(result.error); setConfirmDelete(false); return; }
      router.push("/admin/rules-setup?tab=rule-sets");
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      <form onSubmit={handleUpdate}>
        <RuleSetFields rs={ruleSet} payCodes={payCodes} />
        <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/admin/rules-setup?tab=rule-sets")}
              className={cancelBtnCls}
            >
              Cancel
            </button>
          </div>
          {!ruleSet.isDefault && (
            confirmDelete ? (
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
                className="text-xs text-red-500 hover:underline dark:text-red-400"
              >
                Delete rule set
              </button>
            )
          )}
        </div>
      </form>
    </div>
  );
}
