import { notFound, redirect } from "next/navigation";
import { SESSION_ENDED_HREF } from "@/lib/auth.config";
import { auth } from "@/lib/auth";
import { manageOrView } from "@/lib/rbac/check-permission";
import { ViewOnly } from "@/components/admin/setup/view-only";
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
  if (!session?.user) redirect(SESSION_ENDED_HREF);
  // Rule Sets on Read opens it to look at, with nothing to change.
  const access = await manageOrView(session.user, "RULES_MANAGE", "RULES_VIEW");
  if (!access) redirect("/dashboard");

  const { id } = await params;
  const [policy, leaveTypes, payCodes] = await Promise.all([getPtoPolicy({ ptoPolicyId: id }), getLeaveTypesAdmin(), getAllPayCodes()]);
  if (!policy.success) notFound();

  // Dates cross to the client as plain values.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return (
    <ViewOnly on={access === "view"}>
      <LeavePolicyEditor
        policy={plain(policy.data) as unknown as PolicyRow}
        leaveTypes={plain(leaveTypes.success ? leaveTypes.data : [])}
        payCodes={plain(payCodes.success ? payCodes.data : [])}
      />
    </ViewOnly>
  );
}
