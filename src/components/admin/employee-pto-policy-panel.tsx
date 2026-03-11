"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignEmployeePtoPolicyOverride } from "@/actions/pto-policy.actions";

type LeaveTypeOption = { id: string; name: string; category: string };
type PolicyOption = { id: string; name: string };

type OverrideRow = {
  leaveTypeId: string;
  ptoPolicyId: string;
};

type SiteAssignmentRow = {
  leaveTypeId: string;
  ptoPolicyId: string;
  policyName: string;
};

interface Props {
  employeeId: string;
  leaveTypes: LeaveTypeOption[];
  policies: PolicyOption[];
  overrides: OverrideRow[];
  siteAssignments: SiteAssignmentRow[];
}

export function EmployeePtoPolicyPanel({
  employeeId,
  leaveTypes,
  policies,
  overrides,
  siteAssignments,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingLeaveTypeId, setPendingLeaveTypeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localOverrides, setLocalOverrides] = useState<Map<string, string>>(
    new Map(overrides.map((o) => [o.leaveTypeId, o.ptoPolicyId]))
  );

  const siteMap = new Map(siteAssignments.map((s) => [s.leaveTypeId, s.policyName]));

  function handleSave(leaveTypeId: string, ptoPolicyId: string | null) {
    setPendingLeaveTypeId(leaveTypeId);
    setError(null);
    startTransition(async () => {
      const result = await assignEmployeePtoPolicyOverride({ employeeId, leaveTypeId, ptoPolicyId });
      if (!result.success) {
        setError(result.error);
      } else {
        const next = new Map(localOverrides);
        if (ptoPolicyId) {
          next.set(leaveTypeId, ptoPolicyId);
        } else {
          next.delete(leaveTypeId);
        }
        setLocalOverrides(next);
        router.refresh();
      }
      setPendingLeaveTypeId(null);
    });
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-400">
              <th className="pb-1 pr-4 font-medium">Leave Type</th>
              <th className="pb-1 pr-4 font-medium">Employee Override</th>
              <th className="pb-1 pr-4 font-medium">Effective Policy</th>
            </tr>
          </thead>
          <tbody>
            {leaveTypes.map((lt) => {
              const overridePolicyId = localOverrides.get(lt.id) ?? "";
              const sitePolicyName = siteMap.get(lt.id);
              const isSaving = isPending && pendingLeaveTypeId === lt.id;

              const overridePolicyName = policies.find((p) => p.id === overridePolicyId)?.name;
              const effectiveLabel = overridePolicyName
                ? <span className="font-medium text-indigo-600 dark:text-indigo-400">{overridePolicyName} (override)</span>
                : sitePolicyName
                ? <span className="text-zinc-600 dark:text-zinc-300">{sitePolicyName} (site)</span>
                : <span className="text-zinc-400">Flat rate / tenant default</span>;

              return (
                <tr key={lt.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-4 font-medium text-zinc-700 dark:text-zinc-300">{lt.name}</td>
                  <td className="py-2 pr-4">
                    <select
                      value={overridePolicyId}
                      onChange={(e) => handleSave(lt.id, e.target.value || null)}
                      disabled={isSaving}
                      className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white disabled:opacity-60"
                    >
                      <option value="">— No override —</option>
                      {policies.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {isSaving && <span className="ml-2 text-xs text-zinc-400">Saving…</span>}
                  </td>
                  <td className="py-2 text-xs">{effectiveLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {leaveTypes.length === 0 && (
        <p className="text-xs text-zinc-400">No active leave types configured.</p>
      )}
    </div>
  );
}
