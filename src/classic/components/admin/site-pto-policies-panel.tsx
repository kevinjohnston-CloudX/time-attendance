"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignSitePtoPolicy } from "@/actions/pto-policy.actions";

type LeaveTypeOption = { id: string; name: string; category: string };
type PolicyOption = { id: string; name: string };
type SitePolicyRow = {
  leaveTypeId: string;
  ptoPolicyId: string;
};

interface Props {
  siteId: string;
  leaveTypes: LeaveTypeOption[];
  policies: PolicyOption[];
  assignments: SitePolicyRow[];
}

export function SitePtoPoliciesPanel({ siteId, leaveTypes, policies, assignments }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingLeaveTypeId, setPendingLeaveTypeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localAssignments, setLocalAssignments] = useState<Map<string, string>>(
    new Map(assignments.map((a) => [a.leaveTypeId, a.ptoPolicyId]))
  );

  function handleSave(leaveTypeId: string, ptoPolicyId: string | null) {
    setPendingLeaveTypeId(leaveTypeId);
    setError(null);
    startTransition(async () => {
      const result = await assignSitePtoPolicy({ siteId, leaveTypeId, ptoPolicyId });
      if (!result.success) {
        setError(result.error);
      } else {
        const next = new Map(localAssignments);
        if (ptoPolicyId) {
          next.set(leaveTypeId, ptoPolicyId);
        } else {
          next.delete(leaveTypeId);
        }
        setLocalAssignments(next);
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
      <div className="flex flex-col gap-2">
        {leaveTypes.map((lt) => {
          const currentPolicyId = localAssignments.get(lt.id) ?? "";
          const isSaving = isPending && pendingLeaveTypeId === lt.id;

          return (
            <div key={lt.id} className="flex items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
              <span className="w-32 text-sm font-medium text-zinc-700 dark:text-zinc-300 shrink-0">
                {lt.name}
              </span>
              <select
                value={currentPolicyId}
                onChange={(e) => handleSave(lt.id, e.target.value || null)}
                disabled={isSaving}
                className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white disabled:opacity-60"
              >
                <option value="">— None (use tenant default / flat rate) —</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {isSaving && <span className="text-xs text-zinc-400">Saving…</span>}
            </div>
          );
        })}
      </div>
      {leaveTypes.length === 0 && (
        <p className="text-xs text-zinc-400">No active leave types configured.</p>
      )}
    </div>
  );
}
