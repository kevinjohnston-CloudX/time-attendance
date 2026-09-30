"use client";

import { useState } from "react";
import Link from "next/link";

type Agency = {
  id: string;
  code: number;
  description: string;
  laborRate: number | string;
  chargeRate: number | string;
  inactiveOn: string | null;
  maxWorkHours: number | string;
};

interface Props {
  agencies: Agency[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function AgencyFields({ initial, mode: _mode }: { initial?: Agency; mode?: "create" | "edit" }) {
  const [hasInactiveOn, setHasInactiveOn] = useState(!!initial?.inactiveOn);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">
          Agency Code <span className="text-red-500">*</span>
        </label>
        <input
          name="code"
          type="number"
          min={0}
          required
          defaultValue={initial?.code ?? 0}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">
          Description <span className="text-red-500">*</span>
        </label>
        <input
          name="description"
          required
          maxLength={255}
          defaultValue={initial?.description ?? ""}
          placeholder="e.g. Bergen"
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Labor Rate</label>
        <input
          name="laborRate"
          type="number"
          step="0.000001"
          min={0}
          defaultValue={Number(initial?.laborRate ?? 0)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Charge Rate</label>
        <input
          name="chargeRate"
          type="number"
          step="0.000001"
          min={0}
          defaultValue={Number(initial?.chargeRate ?? 0)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Max Allowed Work Hours</label>
        <input
          name="maxWorkHours"
          type="number"
          step="0.01"
          min={0}
          defaultValue={Number(initial?.maxWorkHours ?? 0)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Inactive On</label>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="inactiveOnToggle"
            checked={hasInactiveOn}
            onChange={(e) => setHasInactiveOn(e.target.checked)}
            className="rounded"
          />
          {hasInactiveOn ? (
            <input
              name="inactiveOn"
              type="date"
              defaultValue={initial?.inactiveOn ? initial.inactiveOn.split("T")[0] : ""}
              className={`${inputCls} flex-1`}
            />
          ) : (
            <span className="text-sm text-zinc-400">Not set</span>
          )}
        </div>
        {!hasInactiveOn && <input type="hidden" name="inactiveOn" value="" />}
      </div>
    </div>
  );
}

export function AgenciesManager({ agencies }: Props) {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const today = new Date().toISOString();
  const searchLower = search.trim().toLowerCase();
  const visible = agencies
    .filter((a) => showInactive || !a.inactiveOn || a.inactiveOn > today)
    .filter((a) =>
      !searchLower ||
      String(a.code).includes(searchLower) ||
      a.description.toLowerCase().includes(searchLower)
    );

  function isActive(a: Agency) {
    return !a.inactiveOn || a.inactiveOn > today;
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search agencies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-700 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
          Show inactive
        </label>
        <Link
          href="/admin/site-settings/agencies/new"
          className="ml-auto rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Add Agency
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">
            {searchLower ? `No agencies match "${search}".` : "No agencies yet."}
          </p>
        )}
        {visible.map((a) => (
          <Link
            key={a.id}
            href={`/admin/site-settings/agencies/${a.id}`}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {a.code}
                </span>
                <span className={`font-medium ${isActive(a) ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {a.description}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-400">
                  Labor: ${Number(a.laborRate).toFixed(6)} · Charge: ${Number(a.chargeRate).toFixed(6)}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${isActive(a) ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {isActive(a) ? "Active" : "Inactive"}
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
