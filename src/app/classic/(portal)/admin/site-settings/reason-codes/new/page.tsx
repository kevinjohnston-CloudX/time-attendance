import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { CreateReasonCodeClient } from "./create-reason-code-client";

export default async function NewReasonCodePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasManage = await userHasPermission(session.user, "PAY_PERIOD_MANAGE");
  if (!hasManage) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=reason-codes" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Reason Codes
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">New Reason Code</h1>
      <CreateReasonCodeClient />
    </div>
  );
}
