import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { CreateShiftClient } from "./create-shift-client";

export default async function NewShiftPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasManage) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/rules-setup?tab=shifts" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">← Shifts</Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">New Shift</h1>
      <CreateShiftClient />
    </div>
  );
}
