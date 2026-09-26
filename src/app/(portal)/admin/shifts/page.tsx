import { redirect } from "next/navigation";

export default function ShiftsPage() {
  redirect("/admin/rules-setup?tab=shifts");
}
