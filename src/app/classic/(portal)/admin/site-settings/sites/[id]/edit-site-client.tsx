"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSite } from "@/actions/admin.actions";
import { SiteFields } from "@/classic/components/admin/sites-manager";

const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

interface Props {
  site: { id: string; name: string; timezone: string; address: string | null; isActive: boolean };
}

export function EditSiteClient({ site }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateSite({
        siteId: site.id,
        name: fd.get("name") as string,
        timezone: (fd.get("timezone") as string) || "America/New_York",
        address: (fd.get("address") as string) || "",
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      router.push("/admin/site-settings?tab=sites");
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
      )}
      <form onSubmit={handleSave}>
        <SiteFields initial={site} mode="edit" />
        <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <button type="submit" disabled={isPending} className={saveBtnCls}>
            {isPending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/site-settings?tab=sites")}
            className={cancelBtnCls}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
