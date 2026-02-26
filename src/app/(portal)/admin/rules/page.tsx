import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getRuleSets } from "@/actions/admin.actions";
import { RuleSetsManager } from "@/components/admin/rule-sets-manager";

export default async function RulesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "RULES_MANAGE")) redirect("/admin");

  const result = await getRuleSets();
  if (!result.success) redirect("/admin");

  return (
    <div>
      <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Rule Sets</h1>
      <RuleSetsManager ruleSets={result.data} />
    </div>
  );
}
