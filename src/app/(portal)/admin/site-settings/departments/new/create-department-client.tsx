"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDepartment } from "@/actions/admin.actions";
import { DepartmentFields } from "@/components/admin/departments-manager";
import type { Site } from "@prisma/client";

const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

export function CreateDepartmentClient({ sites }: { sites: Site[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [siteIds, setSiteIds] = useState<string[]>([]);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (siteIds.length === 0) { setError("Select at least one site."); return; }
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createDepartment({
        name: fd.get("name") as string,
        siteIds,
      });
      if (!result.success) { setError(result.error); return; }
      router.push("/admin/site-settings?tab=departments");
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
      )}
      <form onSubmit={handleCreate}>
        <DepartmentFields
          sites={sites}
          selectedSiteIds={siteIds}
          onSiteIdsChange={setSiteIds}
          mode="create"
        />
        <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <button type="submit" disabled={isPending} className={saveBtnCls}>
            {isPending ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/site-settings?tab=departments")}
            className={cancelBtnCls}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
