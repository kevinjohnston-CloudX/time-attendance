import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getSitePolicySetup } from "@/actions/pto-policy.actions";
import { SitePtoPoliciesPanel } from "@/classic/components/admin/site-pto-policies-panel";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "SITE_MANAGE")) redirect("/admin");

  // Changed from prod, which read the site by id alone and every company's
  // leave types: the shared lookup scopes all of it to this company, and a
  // site that is not theirs is not found.
  const setup = await getSitePolicySetup({ siteId: id });
  if (!setup.success) notFound();
  const { site, leaveTypes, policies: ptoPolicies, assignments: siteAssignments } = setup.data;

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
