import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getPtoPolicies } from "@/actions/pto-policy.actions";
import { db } from "@/lib/db";
import { PtoPoliciesManager } from "@/components/admin/pto-policies-manager";

export default async function PtoPoliciesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "RULES_MANAGE")) redirect("/admin");

  const [policiesResult, leaveTypes] = await Promise.all([
    getPtoPolicies(),
    db.leaveType.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true },
    }),
  ]);

  const policies = policiesResult.success ? policiesResult.data : [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">PTO Policies</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Define tenure-based accrual rules per leave type. Assign policies to sites or individual employees.
          </p>
        </div>
      </div>

      <PtoPoliciesManager policies={policies as any} leaveTypes={leaveTypes} />
    </div>
  );
}
