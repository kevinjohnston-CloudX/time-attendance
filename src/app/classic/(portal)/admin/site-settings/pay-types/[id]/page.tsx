import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getPayTypes } from "@/actions/pay-type.actions";
import { EditPayTypeClient } from "./edit-pay-type-client";

export default async function EditPayTypePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const { id } = await params;
  const result = await getPayTypes();
  const payTypes = result.success ? result.data : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payType = (payTypes as any[]).find((pt) => pt.id === id);
  if (!payType) redirect("/admin/site-settings?tab=pay-types");

  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=pay-types" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Pay Types
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Edit Pay Type</h1>
      <EditPayTypeClient payType={serialize(payType)} />
    </div>
  );
}
