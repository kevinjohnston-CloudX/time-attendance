import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { CreatePayCodeClient } from "./create-pay-code-client";

export default async function NewPayCodePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasPayPeriodManage = await userHasPermission(session.user, "PAY_PERIOD_MANAGE");
  if (!hasPayPeriodManage) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=pay-codes" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Pay Codes
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">New Pay Code</h1>
      <CreatePayCodeClient />
    </div>
  );
}
