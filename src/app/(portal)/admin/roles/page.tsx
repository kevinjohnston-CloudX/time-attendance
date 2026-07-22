import { redirect } from "next/navigation";

export default function RolesPage() {
  redirect("/admin/site-settings?tab=roles");
}
