import { redirect } from "next/navigation";

export default function PtoPoliciesPage() {
  redirect("/admin/rules-setup?tab=leave-policies");
}
