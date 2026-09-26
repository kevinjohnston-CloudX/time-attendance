import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getShift } from "@/actions/shift.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { ShiftEditor } from "@/components/admin/shift-editor";

/**
 * One shift's editor. The shift is read inside the caller's company, so an
 * id from another company, or one that does not exist, is a 404.
 */
export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "RULES_MANAGE"))) redirect("/dashboard");

  const { id } = await params;
  const [shift, payCodes] = await Promise.all([getShift({ shiftId: id }), getAllPayCodes()]);
  if (!shift.success) notFound();

  // Dates, decimals and JSON columns cross to the client as plain values.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return <ShiftEditor shift={plain(shift.data)} payCodes={plain(payCodes.success ? payCodes.data : [])} />;
}
