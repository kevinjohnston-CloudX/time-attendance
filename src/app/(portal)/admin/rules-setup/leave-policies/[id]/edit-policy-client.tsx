"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePtoPolicy, deletePtoPolicy } from "@/actions/pto-policy.actions";
import { PolicyForm } from "@/components/admin/pto-policies-manager";
import type { Policy, LeaveTypeOption, PayCodeOption, Rule, PostingConfig } from "@/components/admin/pto-policies-manager";
import { Trash2 } from "lucide-react";

const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls = "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

interface Props {
  policy: Policy;
  leaveTypes: LeaveTypeOption[];
  payCodes: PayCodeOption[];
}

export function EditPolicyClient({ policy, leaveTypes, payCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>, rules: Rule[], posting: PostingConfig) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    const rawMax        = fd.get("maxDailyHours") as string;
    const rawNegBal     = fd.get("allowNegativeBalance") as string;
    const rawMaxNeg     = fd.get("maxNegativeHours") as string;
    const rawCarryOn    = fd.get("carryOverEnabled") as string;
    const rawRespectMax = fd.get("carryOverRespectMaxBalance") as string;
    const rawFcEnabled  = fd.get("forecastEnabled") as string;
    const rawFcMode     = fd.get("forecastMode") as string;
    const rawFcMonths   = fd.get("forecastMonths") as string;
    const rawFcApply    = fd.get("forecastApplyToAvailable") as string;
    startTransition(async () => {
      const result = await updatePtoPolicy({
        ptoPolicyId:                policy.id,
        name:                       fd.get("name") as string,
        description:                (fd.get("description") as string) || null,
        isDefault:                  fd.get("isDefault") === "true",
        isActive:                   fd.get("isActive") === "true",
        leaveTypeId:                fd.get("leaveTypeId") as string,
        maxDailyHours:              rawMax      !== "" ? parseFloat(rawMax) : null,
        allowNegativeBalance:       rawNegBal   === "true",
        maxNegativeHours:           rawMaxNeg   !== "" ? parseFloat(rawMaxNeg) : null,
        carryOverEnabled:           rawCarryOn  !== "false",
        carryOverRespectMaxBalance: rawRespectMax === "true",
        forecastEnabled:            rawFcEnabled === "true",
        forecastMode:               rawFcMode    !== "" ? rawFcMode as "MONTHS" | "END_OF_YEAR" : null,
        forecastMonths:             rawFcMonths  !== "" ? parseInt(rawFcMonths, 10) : null,
        forecastApplyToAvailable:   rawFcApply   === "true",
        rules,
        ...posting,
        postingAnchorDate:  posting.postingAnchorDate  ?? null,
        posting2AnchorDate: posting.posting2AnchorDate ?? null,
      });
      if (!result.success) { setError(result.error); return; }
      router.push("/admin/rules-setup?tab=leave-policies");
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deletePtoPolicy({ ptoPolicyId: policy.id });
      if (!result.success) { setError(result.error); setConfirmDelete(false); return; }
      router.push("/admin/rules-setup?tab=leave-policies");
    });
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      <PolicyForm
        leaveTypes={leaveTypes}
        payCodes={payCodes}
        initial={policy}
        isPending={isPending}
        onSubmit={onSubmit}
        onCancel={() => router.push("/admin/rules-setup?tab=leave-policies")}
      />
      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Are you sure?</span>
            <button type="button" onClick={handleDelete} disabled={isPending} className={dangerBtnCls}>{isPending ? "Deleting…" : "Yes, delete"}</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className={cancelBtnCls}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-xs text-red-500 hover:underline dark:text-red-400">
            <Trash2 className="h-3.5 w-3.5" /> Delete policy
          </button>
        )}
      </div>
    </div>
  );
}
