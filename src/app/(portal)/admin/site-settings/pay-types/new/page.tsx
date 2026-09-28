import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { CreatePayTypeClient } from "./create-pay-type-client";

export default async function NewPayTypePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=pay-types" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Pay Types
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">New Pay Type</h1>
      <CreatePayTypeClient />
    </div>
  );
}
