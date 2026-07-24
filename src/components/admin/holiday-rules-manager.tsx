"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createHolidayRule, updateHolidayRule, deleteHolidayRule } from "@/actions/holiday-rule.actions";
import type { HolidayRule } from "@prisma/client";

interface Props {
  rules: HolidayRule[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

const CREDIT_METHOD_LABELS: Record<string, string> = {
  FIXED_HOURS:     "Fixed Hours",
  ACTUAL_WORKED:   "Actual Worked",
  SCHEDULED_HOURS: "Scheduled Hours",
};

const PAY_BUCKET_OPTIONS = [
  { value: "HOLIDAY", label: "Holiday" },
  { value: "REG",     label: "Regular" },
  { value: "OT",      label: "Overtime" },
  { value: "DT",      label: "Double Time" },
];

function formatCredit(rule: HolidayRule): string {
  if (rule.creditMethod === "FIXED_HOURS") {
    const h = rule.creditMinutes / 60;
    return `Fixed ${Number.isInteger(h) ? h : h.toFixed(1)}h`;
  }
  return CREDIT_METHOD_LABELS[rule.creditMethod] ?? rule.creditMethod;
}

function formatPremium(rule: HolidayRule): string {
  return `${(rule.workingPremium / 100).toFixed(2)}× working premium`;
}

function HolidayRuleFields({ rule }: { rule?: HolidayRule }) {
  const [creditMethod, setCreditMethod] = useState<string>(
    rule?.creditMethod ?? "FIXED_HOURS"
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Name */}
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Rule Name</label>
        <input
          name="name"
          required
          defaultValue={rule?.name ?? ""}
          placeholder="e.g. Standard Holiday"
          className={inputCls}
        />
      </div>

      {/* Holiday Credit */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Holiday Credit
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Credit Method</label>
            <select
              name="creditMethod"
              value={creditMethod}
              onChange={(e) => setCreditMethod(e.target.value)}
              className={inputCls}
            >
              <option value="FIXED_HOURS">Fixed Hours</option>
              <option value="ACTUAL_WORKED">Actual Hours Worked</option>
              <option value="SCHEDULED_HOURS">Scheduled Hours</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              Credit Hours{" "}
              {creditMethod !== "FIXED_HOURS" && (
                <span className="text-zinc-400">(unused)</span>
              )}
            </label>
            <input
              name="creditHours"
              type="number"
              step="0.5"
              min="0"
              max="24"
              defaultValue={rule ? rule.creditMinutes / 60 : 8}
              className={`${inputCls} ${creditMethod !== "FIXED_HOURS" ? "opacity-40" : ""}`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              Max Credit Hours <span className="text-zinc-400">(0 = no cap)</span>
            </label>
            <input
              name="maxCreditHours"
              type="number"
              step="0.5"
              min="0"
              max="24"
              defaultValue={rule ? rule.maxCreditMinutes / 60 : 0}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Pay Bucket</label>
            <select
              name="payBucket"
              defaultValue={rule?.payBucket ?? "HOLIDAY"}
              className={inputCls}
            >
              {PAY_BUCKET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Working Premium */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Working Premium
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              Multiplier for Hours Worked on Holiday
            </label>
            <div className="flex items-center gap-2">
              <input
                name="workingPremium"
                type="number"
                step="0.25"
                min="1.00"
                max="5.00"
                defaultValue={rule ? (rule.workingPremium / 100).toFixed(2) : "2.00"}
                className={`${inputCls} max-w-[120px]`}
              />
              <span className="text-sm text-zinc-500">×</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              e.g. 2.00 = double time for any hours physically worked on the holiday
            </p>
          </div>
        </div>
      </div>

      {/* Eligibility */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Eligibility
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Require Day Before</label>
            <select
              name="requireDayBefore"
              defaultValue={rule?.requireDayBefore ? "true" : "false"}
              className={inputCls}
            >
              <option value="false">No requirement</option>
              <option value="true">Yes — must work day before</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Require Day After</label>
            <select
              name="requireDayAfter"
              defaultValue={rule?.requireDayAfter ? "true" : "false"}
              className={inputCls}
            >
              <option value="false">No requirement</option>
              <option value="true">Yes — must work day after</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              Min. Period Hours <span className="text-zinc-400">(0 = none)</span>
            </label>
            <input
              name="minPeriodHours"
              type="number"
              step="0.5"
              min="0"
              defaultValue={rule ? rule.minPeriodMinutes / 60 : 0}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {/* Overtime */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Overtime
        </p>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">
            Count Credited Hours Toward Weekly OT
          </label>
          <select
            name="countTowardOt"
            defaultValue={rule?.countTowardOt !== false ? "true" : "false"}
            className={`${inputCls} max-w-xs`}
          >
            <option value="true">Yes — include in OT calculation</option>
            <option value="false">No — exclude from OT calculation</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export function HolidayRulesManager({ rules }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const visible = showInactive ? rules : rules.filter((r) => r.isActive);

  function buildPayload(fd: FormData) {
    return {
      name:             fd.get("name") as string,
      creditMethod:     fd.get("creditMethod") as string,
      creditHours:      Number(fd.get("creditHours") ?? 8),
      maxCreditHours:   Number(fd.get("maxCreditHours") ?? 0),
      payBucket:        fd.get("payBucket") as string,
      workingPremium:   Number(fd.get("workingPremium") ?? 2.0),
      requireDayBefore: fd.get("requireDayBefore") as string,
      requireDayAfter:  fd.get("requireDayAfter") as string,
      minPeriodHours:   Number(fd.get("minPeriodHours") ?? 0),
      countTowardOt:    fd.get("countTowardOt") as string,
    };
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload = buildPayload(new FormData(e.currentTarget));
    setError(null);
    startTransition(async () => {
      const result = await createHolidayRule(payload);
      if (!result.success) { setError(result.error); return; }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(rule: HolidayRule, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateHolidayRule({
        ruleId:   rule.id,
        isActive: fd.get("isActive") as string,
        ...buildPayload(fd),
      });
      if (!result.success) { setError(result.error); return; }
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(ruleId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteHolidayRule({ ruleId });
      if (!result.success) { setError(result.error); return; }
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mb-3 flex items-center gap-3">
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
          <p className="text-sm text-zinc-400">No holiday rules yet. Add one below.</p>
        )}

        {visible.map((rule) => {
          if (confirmDeleteId === rule.id) {
            return (
              <div
                key={rule.id}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/40 dark:bg-red-900/10"
              >
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  Delete <span className="font-semibold">{rule.name}</span>? This cannot be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleDelete(rule.id)}
                    disabled={isPending}
                    className={dangerBtnCls}
                  >
                    {isPending ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className={cancelBtnCls}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          }

          if (editingId === rule.id) {
            return (
              <form
                key={rule.id}
                onSubmit={(e) => handleUpdate(rule, e)}
                className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800/40 dark:bg-blue-900/10"
              >
                <HolidayRuleFields rule={rule} />
                <div className="mt-4 grid grid-cols-4 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Status</label>
                    <select
                      name="isActive"
                      defaultValue={rule.isActive ? "true" : "false"}
                      className={inputCls}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="submit" disabled={isPending} className={saveBtnCls}>
                    {isPending ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className={cancelBtnCls}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            );
          }

          return (
            <div
              key={rule.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-4">
                <p className="font-medium text-zinc-900 dark:text-white">{rule.name}</p>
                <p className="text-sm text-zinc-500">{formatCredit(rule)}</p>
                <p className="text-sm text-zinc-400">{formatPremium(rule)}</p>
                {(rule.requireDayBefore || rule.requireDayAfter) && (
                  <p className="text-xs text-zinc-400">
                    Requires:{" "}
                    {[
                      rule.requireDayBefore && "day before",
                      rule.requireDayAfter && "day after",
                    ]
                      .filter(Boolean)
                      .join(" & ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    rule.isActive
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}
                >
                  {rule.isActive ? "Active" : "Inactive"}
                </span>
                <button
                  onClick={() => {
                    setEditingId(rule.id);
                    setConfirmDeleteId(null);
                  }}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    setConfirmDeleteId(rule.id);
                    setEditingId(null);
                  }}
                  className="text-xs text-red-500 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showCreate ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">
            New Holiday Rule
          </p>
          <HolidayRuleFields />
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>
              {isPending ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className={cancelBtnCls}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
        >
          + Add Holiday Rule
        </button>
      )}
    </div>
  );
}
