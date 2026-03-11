import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import { getSitePtoPolicies, getPtoPolicies } from "@/actions/pto-policy.actions";
import { SitePtoPoliciesPanel } from "@/components/admin/site-pto-policies-panel";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "SITE_MANAGE")) redirect("/admin");

  const [site, leaveTypes, ptoPoliciesResult, siteAssignmentsResult] = await Promise.all([
    db.site.findUnique({ where: { id } }),
    db.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }),
    getPtoPolicies(),
    getSitePtoPolicies({ siteId: id }),
  ]);

  if (!site) notFound();

  const ptoPolicies = ptoPoliciesResult.success
    ? ptoPoliciesResult.data.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name }))
    : [];

  const siteAssignments = siteAssignmentsResult.success
    ? siteAssignmentsResult.data.map((a) => ({
        leaveTypeId: a.leaveTypeId,
        ptoPolicyId: a.ptoPolicyId,
      }))
    : [];

  return (
    <div className="max-w-2xl">
      <Link href="/admin/sites" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Sites
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">{site.name}</h1>
      <p className="mt-0.5 text-sm text-zinc-500">{site.timezone}{site.address ? ` · ${site.address}` : ""}</p>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">PTO Policy Assignments</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Set the accrual policy for each leave type at this site. Employees without a personal override will use this policy.
        </p>
        <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <SitePtoPoliciesPanel
            siteId={site.id}
            leaveTypes={leaveTypes}
            policies={ptoPolicies}
            assignments={siteAssignments}
          />
        </div>
      </div>
    </div>
  );
}
