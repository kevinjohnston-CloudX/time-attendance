import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getLeaveTypesAdmin } from "@/actions/admin.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { LeavePolicyEditor } from "@/components/admin/leave-policy-editor";

/** A new leave policy, on the same page the existing ones are edited on. */
export default async function NewLeavePolicyPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "RULES_MANAGE"))) redirect("/dashboard");

  const [leaveTypes, payCodes] = await Promise.all([getLeaveTypesAdmin(), getAllPayCodes()]);
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return (
    <LeavePolicyEditor
      policy={null}
      leaveTypes={plain(leaveTypes.success ? leaveTypes.data.filter((l) => l.isActive) : [])}
      payCodes={plain(payCodes.success ? payCodes.data : [])}
    />
  );
}
