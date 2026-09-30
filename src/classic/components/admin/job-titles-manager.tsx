"use client";

import { useState } from "react";
import Link from "next/link";

type JobTitle = {
  id: string;
  name: string;
  externalId: string | null;
  isActive: boolean;
};

interface Props {
  jobTitles: JobTitle[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function JobTitleFields({ initial, mode }: { initial?: JobTitle; mode?: "create" | "edit" }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">
            Job Title Name <span className="text-red-500">*</span>
          </label>
          <input
            name="name"
            required
            maxLength={255}
            defaultValue={initial?.name ?? ""}
            placeholder="e.g. Senior Engineer"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">ID / Code</label>
          <input
            name="externalId"
            maxLength={100}
            defaultValue={initial?.externalId ?? ""}
            placeholder="e.g. SE-001"
            className={inputCls}
          />
        </div>
      </div>
      {mode === "edit" && initial && (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Status</label>
          <select name="isActive" defaultValue={initial.isActive ? "true" : "false"} className={inputCls}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      )}
    </div>
  );
}

export function JobTitlesManager({ jobTitles }: Props) {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const searchLower = search.trim().toLowerCase();
  const visible = (showInactive ? jobTitles : jobTitles.filter((jt) => jt.isActive)).filter(
    (jt) =>
      !searchLower ||
      jt.name.toLowerCase().includes(searchLower) ||
      (jt.externalId ?? "").toLowerCase().includes(searchLower)
  );

  return (
    <div className="mt-6">
      {/* Toolbar */}
      <div className="mb-3 flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search job titles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-700 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
        <Link
          href="/admin/site-settings/job-titles/new"
          className="ml-auto rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Add Job Title
        </Link>
      </div>

      {/* List */}
      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">
            {searchLower ? `No job titles match "${search}".` : "No job titles yet."}
          </p>
        )}
        {visible.map((jt) => (
          <Link
            key={jt.id}
            href={`/admin/site-settings/job-titles/${jt.id}`}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`font-medium ${jt.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {jt.name}
                </span>
                {jt.externalId && (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {jt.externalId}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${jt.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {jt.isActive ? "Active" : "Inactive"}
                </span>
                <span className="text-xs text-zinc-400">Edit →</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
