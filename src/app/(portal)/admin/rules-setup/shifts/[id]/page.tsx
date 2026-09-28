import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getShifts } from "@/actions/shift.actions";
import { EditShiftClient } from "./edit-shift-client";

export default async function EditShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasManage) redirect("/dashboard");
  const { id } = await params;
  const result = await getShifts();
  const shifts = result.success ? result.data : [];
  const shift = shifts.find((s) => s.id === id);
  if (!shift) redirect("/admin/rules-setup?tab=shifts");
  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/rules-setup?tab=shifts" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">← Shifts</Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{shift.name}</h1>
      <EditShiftClient shift={serialize(shift)} />
    </div>
  );
}
