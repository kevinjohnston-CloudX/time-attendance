import { redirect } from "next/navigation";

export default function ShiftsPage() {
  redirect("/admin/site-settings?tab=shifts");
}
