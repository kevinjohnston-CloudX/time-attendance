import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { ShiftEditor } from "@/components/admin/shift-editor";

/** A new shift, on the same page the existing ones are edited on. */
export default async function NewShiftPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "RULES_MANAGE"))) redirect("/dashboard");

  const payCodes = await getAllPayCodes();
  return <ShiftEditor shift={null} payCodes={JSON.parse(JSON.stringify(payCodes.success ? payCodes.data : []))} />;
}
