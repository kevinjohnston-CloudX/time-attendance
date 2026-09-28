"use client";

import Link from "next/link";
import type { Site } from "@prisma/client";

interface Props { sites: Site[] }

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function SiteFields({
  initial,
  mode = "create",
}: {
  initial?: { name: string; timezone: string; address: string | null; isActive: boolean };
  mode?: "create" | "edit";
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Name</label>
        <input name="name" required defaultValue={initial?.name ?? ""} placeholder="e.g. Main Office" className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Timezone</label>
        <input name="timezone" defaultValue={initial?.timezone ?? "America/New_York"} placeholder="e.g. America/New_York" className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Address <span className="text-zinc-400">(optional)</span></label>
        <input name="address" defaultValue={initial?.address ?? ""} placeholder="e.g. 123 Main St" className={inputCls} />
      </div>
      {mode === "edit" && (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Status</label>
          <select name="isActive" defaultValue={initial?.isActive ? "true" : "false"} className={inputCls}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      )}
    </div>
  );
}

export function SitesManager({ sites }: Props) {
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-2">
        {sites.map((site) => (
          <div
            key={site.id}
            className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <Link href={`/admin/site-settings/sites/${site.id}`} className="flex flex-1 min-w-0 items-center gap-3">
              <span className={`font-medium ${site.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                {site.name}
              </span>
              <span className="text-xs text-zinc-400">{site.timezone}</span>
              {site.address && <span className="text-xs text-zinc-400">{site.address}</span>}
              {!site.isActive && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Inactive</span>
              )}
            </Link>
            <div className="flex items-center gap-3">
              <Link href={`/admin/sites/${site.id}`} className="text-xs text-violet-600 hover:underline dark:text-violet-400">
                PTO Rules
              </Link>
              <span className="text-xs text-zinc-400">→</span>
            </div>
          </div>
        ))}
      </div>

      <Link
        href="/admin/site-settings/sites/new"
        className="mt-4 inline-block rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:hover:border-zinc-400"
      >
        + Add Site
      </Link>
    </div>
  );
}
