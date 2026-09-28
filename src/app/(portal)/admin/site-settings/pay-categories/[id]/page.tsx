import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getPayCategories } from "@/actions/pay-category.actions";
import { getPtoPolicies } from "@/actions/pto-policy.actions";
import { getLeaveTypesAdmin } from "@/actions/admin.actions";
import { EditPayCategoryClient } from "./edit-pay-category-client";

export default async function EditPayCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const { id } = await params;
  const [catResult, policiesResult, ltResult] = await Promise.all([
    getPayCategories(),
    getPtoPolicies(),
    getLeaveTypesAdmin(),
  ]);

  const categories = catResult.success ? (catResult as { success: true; data: any[] }).data : [];
  const category = categories.find((c: any) => c.id === id);
  if (!category) redirect("/admin/site-settings?tab=pay-categories");

  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=pay-categories" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Pay Categories
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Edit Pay Category</h1>
      <EditPayCategoryClient
        category={serialize(category)}
        ptoPolicies={serialize(policiesResult.success ? (policiesResult as { success: true; data: any[] }).data : [])}
        leaveTypes={serialize(ltResult.success ? (ltResult as { success: true; data: any[] }).data : [])}
      />
    </div>
  );
}
