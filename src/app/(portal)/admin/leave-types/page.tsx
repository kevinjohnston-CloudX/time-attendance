import { redirect } from "next/navigation";

export default function LeaveTypesPage() {
  redirect("/admin/site-settings?tab=leave-types");
}
