import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { EditPayCodeClient } from "./edit-pay-code-client";

export default async function EditPayCodePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasPayPeriodManage = await userHasPermission(session.user, "PAY_PERIOD_MANAGE");
  if (!hasPayPeriodManage) redirect("/dashboard");

  const { id } = await params;
  const result = await getAllPayCodes();
  const payCodes = result.success ? result.data : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payCode = (payCodes as any[]).find((pc) => pc.id === id);
  if (!payCode) redirect("/admin/site-settings?tab=pay-codes");

  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=pay-codes" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Pay Codes
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Edit Pay Code</h1>
      <EditPayCodeClient payCode={serialize(payCode)} />
    </div>
  );
}
