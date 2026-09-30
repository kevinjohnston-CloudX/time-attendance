import { redirect } from "next/navigation";

/** The classic design adds a leave type on a page of its own; this design opens Company Setup's window. */
export default function NewLeaveTypesPage() {
  redirect("/admin/site-settings?tab=leave-types&new=1");
}
