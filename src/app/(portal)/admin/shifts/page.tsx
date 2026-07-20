import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getShifts } from "@/actions/shift.actions";
import { ShiftsManager } from "@/components/admin/shifts-manager";

export default async function ShiftsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "RULES_MANAGE")) redirect("/admin");

  const result = await getShifts();
  const shifts = result.success ? result.data : [];

  return (
    <div>
      <Link
        href="/admin"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Shifts</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Define shift types with start and end times to assign to employees.
      </p>
      <ShiftsManager shifts={shifts} />
    </div>
  );
}
