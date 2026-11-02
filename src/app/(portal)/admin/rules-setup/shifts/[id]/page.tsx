import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { manageOrView } from "@/lib/rbac/check-permission";
import { ViewOnly } from "@/components/admin/setup/view-only";
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
  // Rule Sets on Read opens it to look at, with nothing to change.
  const access = await manageOrView(session.user, "RULES_MANAGE", "RULES_VIEW");
  if (!access) redirect("/dashboard");

  const { id } = await params;
  const [shift, payCodes] = await Promise.all([getShift({ shiftId: id }), getAllPayCodes()]);
  if (!shift.success) notFound();

  // Dates, decimals and JSON columns cross to the client as plain values.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return (
    <ViewOnly on={access === "view"}>
      <ShiftEditor shift={plain(shift.data)} payCodes={plain(payCodes.success ? payCodes.data : [])} />
    </ViewOnly>
  );
}
