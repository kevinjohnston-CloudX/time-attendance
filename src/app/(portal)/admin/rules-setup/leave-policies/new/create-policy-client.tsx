"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPtoPolicy } from "@/actions/pto-policy.actions";
import { PolicyForm } from "@/components/admin/pto-policies-manager";
import type { LeaveTypeOption, PayCodeOption, Rule, PostingConfig } from "@/components/admin/pto-policies-manager";

interface Props {
  leaveTypes: LeaveTypeOption[];
  payCodes: PayCodeOption[];
}

export function CreatePolicyClient({ leaveTypes, payCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      const result = await createPtoPolicy({
        name:                       fd.get("name") as string,
        description:                (fd.get("description") as string) || undefined,
        isDefault:                  fd.get("isDefault") === "true",
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
      if ("success" in result && !result.success) { setError((result as { success: false; error: string }).error); return; }
      router.push("/admin/rules-setup?tab=leave-policies");
    });
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      <PolicyForm
        leaveTypes={leaveTypes}
        payCodes={payCodes}
        isPending={isPending}
        onSubmit={onSubmit}
        onCancel={() => router.push("/admin/rules-setup?tab=leave-policies")}
      />
    </div>
  );
}
