import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { manageOrView } from "@/lib/rbac/check-permission";
import { ViewOnly } from "@/components/admin/setup/view-only";
import { getSitePolicySetup } from "@/actions/pto-policy.actions";
import { SitePage } from "@/components/admin/site-page";

/**
 * One site: its name, time zone and address in the header, with Edit site,
 * and the leave policy each leave type uses at this site.
 *
 * <p>Everything is read through getSitePolicySetup, which is gated on
 * SITE_MANAGE or SITE_VIEW and scoped to the caller's company. A site of
 * another company answers "not found", the same as one that does not exist.
 * With SITE_VIEW alone the page is view only: no Edit site, and the
 * policies cannot be changed.
 */
export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const access = await manageOrView(session.user, "SITE_MANAGE", "SITE_VIEW");
  if (!access) redirect("/admin");

  const result = await getSitePolicySetup({ siteId: id });
  if (!result.success) notFound();

  const { site, leaveTypes, policies, assignments } = result.data;
  return (
    <ViewOnly on={access === "view"}>
      <SitePage
        site={JSON.parse(JSON.stringify(site))}
        leaveTypes={leaveTypes}
        policies={policies}
        assignments={assignments}
      />
    </ViewOnly>
  );
}
