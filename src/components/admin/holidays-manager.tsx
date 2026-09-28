"use client";

import { useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";

interface HolidayRule { id: string; name: string; number?: number | null }

interface HolidayWithRules {
  id: string;
  name: string;
  date: Date | string;
  observedDate?: Date | string | null;
  isActive: boolean;
  bypassAfterEligibility: boolean;
  holidayRules?: { holidayRuleId: string }[];
}

interface Props {
  holidays: HolidayWithRules[];
  holidayRules: HolidayRule[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

function toDateInputValue(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  // Use UTC components to avoid local-timezone day shift
  return d.toISOString().slice(0, 10);
}

function formatUTCDate(date: Date | string, fmt: string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  // Build a local-midnight Date from UTC components so date-fns format stays on the right day
  const utc = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return format(utc, fmt);
}

function ruleLabel(r: HolidayRule) {
  return r.number != null ? `${r.number} [${r.name}]` : r.name;
}

export function DualListbox({
  allRules,
  selectedIds,
  onChange,
}: {
  allRules: HolidayRule[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [availSel, setAvailSel] = useState<string[]>([]);
  const [chosenSel, setChosenSel] = useState<string[]>([]);

  const available = allRules.filter((r) => !selectedIds.includes(r.id));
  const chosen = allRules.filter((r) => selectedIds.includes(r.id));

  function moveToChosen() {
    onChange([...selectedIds, ...availSel]);
    setAvailSel([]);
  }

  function moveToAvailable() {
    onChange(selectedIds.filter((id) => !chosenSel.includes(id)));
    setChosenSel([]);
  }

  function moveAllToChosen() {
    onChange(allRules.map((r) => r.id));
    setAvailSel([]);
  }

  function moveAllToAvailable() {
    onChange([]);
    setChosenSel([]);
  }

  const listCls =
    "h-40 w-full overflow-y-auto rounded-lg border border-zinc-300 bg-white text-sm dark:border-zinc-600 dark:bg-zinc-800";
  const optCls = (sel: boolean) =>
    `cursor-pointer select-none px-2.5 py-1 ${sel ? "bg-blue-600 text-white" : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"}`;

  return (
    <div className="flex items-center gap-2">
      {/* Available */}
      <div className="flex-1">
        <p className="mb-1 text-xs text-zinc-500">Available Items</p>
        <div className={listCls}>
          {available.length === 0 && (
            <p className="px-2.5 py-1 text-xs italic text-zinc-400">All rules assigned</p>
          )}
          {available.map((r) => (
            <div
              key={r.id}
              className={optCls(availSel.includes(r.id))}
              onClick={() =>
                setAvailSel((prev) =>
                  prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]
                )
              }
            >
              {ruleLabel(r)}
            </div>
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          title="Add selected"
          onClick={moveToChosen}
          disabled={availSel.length === 0}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          &gt;
        </button>
        <button
          type="button"
          title="Add all"
          onClick={moveAllToChosen}
          disabled={available.length === 0}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          &gt;&gt;
        </button>
        <button
          type="button"
          title="Remove selected"
          onClick={moveToAvailable}
          disabled={chosenSel.length === 0}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          &lt;
        </button>
        <button
          type="button"
          title="Remove all"
          onClick={moveAllToAvailable}
          disabled={chosen.length === 0}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          &lt;&lt;
        </button>
      </div>

      {/* Selected */}
      <div className="flex-1">
        <p className="mb-1 text-xs text-zinc-500">Selected Items</p>
        <div className={listCls}>
          {chosen.length === 0 && (
            <p className="px-2.5 py-1 text-xs italic text-zinc-400">No rules assigned</p>
          )}
          {chosen.map((r) => (
            <div
              key={r.id}
              className={optCls(chosenSel.includes(r.id))}
              onClick={() =>
                setChosenSel((prev) =>
                  prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]
                )
              }
            >
              {ruleLabel(r)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface HolidayFieldsInitial {
  name?: string;
  date?: Date | string;
  observedOn?: Date | string | null;
  bypassAfterEligibility?: boolean;
  isActive?: boolean;
  holidayRules?: { holidayRuleId: string }[];
}

export function HolidayFields({
  holidayRules,
  initial,
  mode = "create",
}: {
  holidayRules: HolidayRule[];
  initial?: HolidayFieldsInitial;
  mode?: "create" | "edit";
}) {
  const initialRuleIds = (initial?.holidayRules ?? []).map((r) => r.holidayRuleId);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>(initialRuleIds);

  return (
    <div className="flex flex-col gap-4">
      {/* Basic fields */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-zinc-500">Holiday Name</label>
          <input
            name="name"
            required
            defaultValue={initial?.name ?? ""}
            placeholder="e.g. Christmas Day"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Date</label>
          <input
            name="date"
            type="date"
            required
            defaultValue={initial?.date ? toDateInputValue(initial.date) : ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">
            Observed On <span className="text-zinc-400">(optional)</span>
          </label>
          <input
            name="observedOn"
            type="date"
            defaultValue={initial?.observedOn ? toDateInputValue(initial.observedOn) : ""}
            className={inputCls}
          />
        </div>
      </div>

      {/* Status — edit mode only */}
      {mode === "edit" && (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Status</label>
          <select
            name="isActive"
            defaultValue={initial?.isActive ? "true" : "false"}
            className={`${inputCls} max-w-[160px]`}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      )}

      {/* Options */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Options</p>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            name="bypassAfterEligibility"
            value="true"
            defaultChecked={initial?.bypassAfterEligibility ?? false}
            className="mt-0.5 rounded"
          />
          <span>
            Enable the bypass of scheduled workday &ldquo;after&rdquo; eligibility
            <span className="ml-1 text-xs text-zinc-400">
              (Post Holiday bypass option also requires activation in Holiday Rule setup)
            </span>
          </span>
        </label>
      </div>

      {/* Holiday Rule assignment */}
      {holidayRules.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Holiday Rules</p>
          <DualListbox
            allRules={holidayRules}
            selectedIds={selectedRuleIds}
            onChange={setSelectedRuleIds}
          />
          {/* Hidden input carries selected rule IDs to the form */}
          <input type="hidden" name="ruleIds" value={selectedRuleIds.join(",")} />
        </div>
      )}
    </div>
  );
}

export function HolidaysManager({ holidays, holidayRules }: Props) {
  const [showInactive, setShowInactive] = useState(false);

  const currentYear = new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState(String(currentYear));

  const years = [...new Set(holidays.map((h) => new Date(h.date).getUTCFullYear()))].sort(
    (a, b) => b - a
  );
  if (!years.includes(currentYear)) years.unshift(currentYear);

  const visible = holidays
    .filter((h) => showInactive || h.isActive)
    .filter((h) => !yearFilter || new Date(h.date).getUTCFullYear() === Number(yearFilter));

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="">All Years</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">No holidays for this period. Add one below.</p>
        )}
        {visible.map((h) => {
          const assignedCount = h.holidayRules?.length ?? 0;
          return (
            <Link
              key={h.id}
              href={`/admin/site-settings/holidays/${h.id}`}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-center text-xs font-mono font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {formatUTCDate(h.date, "MMM d, yyyy")}
                  </span>
                  <span
                    className={`font-medium ${h.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}
                  >
                    {h.name}
                  </span>
                  {h.observedDate && (
                    <span className="text-xs text-zinc-400">
                      Observed {formatUTCDate(h.observedDate, "MMM d")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {assignedCount > 0 && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      {assignedCount} rule{assignedCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${h.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}
                  >
                    {h.isActive ? "Active" : "Inactive"}
                  </span>
                  <span className="text-xs text-zinc-400">Edit →</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <Link
        href="/admin/site-settings/holidays/new"
        className="mt-4 inline-block rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Holiday
      </Link>
    </div>
  );
}
