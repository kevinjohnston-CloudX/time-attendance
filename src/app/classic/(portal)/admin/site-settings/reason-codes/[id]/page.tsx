import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getReasonCodes } from "@/actions/reason-code.actions";
import { EditReasonCodeClient } from "./edit-reason-code-client";

export default async function EditReasonCodePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasManage = await userHasPermission(session.user, "PAY_PERIOD_MANAGE");
  if (!hasManage) redirect("/dashboard");

  const { id } = await params;
  const result = await getReasonCodes();
  const reasonCodes = result.success ? result.data : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reasonCode = reasonCodes.find((rc: any) => rc.id === id);
  if (!reasonCode) redirect("/admin/site-settings?tab=reason-codes");

  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=reason-codes" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Reason Codes
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Edit Reason Code</h1>
      <EditReasonCodeClient reasonCode={serialize(reasonCode)} />
    </div>
  );
}
