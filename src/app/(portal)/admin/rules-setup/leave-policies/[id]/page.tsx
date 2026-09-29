import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getPtoPolicies } from "@/actions/pto-policy.actions";
import { getLeaveTypesAdmin } from "@/actions/admin.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { EditPolicyClient } from "./edit-policy-client";

export default async function EditPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasManage) redirect("/dashboard");
  const { id } = await params;
  const [policiesResult, leaveTypesResult, payCodesResult] = await Promise.all([
    getPtoPolicies(),
    getLeaveTypesAdmin(),
    getAllPayCodes(),
  ]);
  const policies = policiesResult.success ? policiesResult.data : [];
  const policy = policies.find((p) => p.id === id);
  if (!policy) redirect("/admin/rules-setup?tab=leave-policies");
  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/rules-setup?tab=leave-policies" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">← Leave Policies</Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{policy.name}</h1>
      <EditPolicyClient
        policy={serialize({ ...policy, _count: { ...policy._count, empOverrides: 0 } })}
        leaveTypes={serialize(leaveTypesResult.success ? leaveTypesResult.data : [])}
        payCodes={serialize(payCodesResult.success ? payCodesResult.data : [])}
      />
    </div>
  );
}
