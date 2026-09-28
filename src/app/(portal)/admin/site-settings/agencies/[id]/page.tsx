import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAgencies } from "@/actions/agency.actions";
import { EditAgencyClient } from "./edit-agency-client";

export default async function EditAgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const { id } = await params;
  const result = await getAgencies();
  const agencies = result.success ? result.data : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agency = (agencies as any[]).find((a) => a.id === id);
  if (!agency) redirect("/admin/site-settings?tab=agencies");

  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=agencies" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Agencies
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Edit Agency</h1>
      <EditAgencyClient agency={serialize(agency)} />
    </div>
  );
}
