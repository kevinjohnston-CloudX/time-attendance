import { redirect } from "next/navigation";

export default function RulesPage() {
  redirect("/admin/rules-setup?tab=rule-sets");
}
