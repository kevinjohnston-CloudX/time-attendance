import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getSitePolicySetup } from "@/actions/pto-policy.actions";
import { SitePage } from "@/components/admin/site-page";

/**
 * One site: its name, time zone and address in the header, with Edit site,
 * and the leave policy each leave type uses at this site.
 *
 * <p>Everything is read through getSitePolicySetup, which is gated on
 * SITE_MANAGE and scoped to the caller's company. A site of another company
 * answers "not found", the same as one that does not exist.
 */
export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "SITE_MANAGE"))) redirect("/admin");

  const result = await getSitePolicySetup({ siteId: id });
  if (!result.success) notFound();

  const { site, leaveTypes, policies, assignments } = result.data;
  return (
    <SitePage
      site={JSON.parse(JSON.stringify(site))}
      leaveTypes={leaveTypes}
      policies={policies}
      assignments={assignments}
    />
  );
}
