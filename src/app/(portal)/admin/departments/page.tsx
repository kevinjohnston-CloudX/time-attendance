import { redirect } from "next/navigation";

export default function DepartmentsPage() {
  redirect("/admin/site-settings?tab=departments");
}
