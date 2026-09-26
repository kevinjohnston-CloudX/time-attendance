import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getPtoPolicy } from "@/actions/pto-policy.actions";
import { getLeaveTypesAdmin } from "@/actions/admin.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { LeavePolicyEditor, type PolicyRow } from "@/components/admin/leave-policy-editor";

/**
 * One leave policy's editor. The policy is read inside the caller's
 * company, so an id from another company, or one that does not exist, is
 * a 404.
 */
export default async function LeavePolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "RULES_MANAGE"))) redirect("/dashboard");

  const { id } = await params;
  const [policy, leaveTypes, payCodes] = await Promise.all([getPtoPolicy({ ptoPolicyId: id }), getLeaveTypesAdmin(), getAllPayCodes()]);
  if (!policy.success) notFound();

  // Dates cross to the client as plain values.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return (
    <LeavePolicyEditor
      policy={plain(policy.data) as unknown as PolicyRow}
      leaveTypes={plain(leaveTypes.success ? leaveTypes.data : [])}
      payCodes={plain(payCodes.success ? payCodes.data : [])}
    />
  );
}
