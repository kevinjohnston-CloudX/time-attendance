import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { db } from "@/lib/db";
import { getSitePtoPolicies, getPtoPolicies } from "@/actions/pto-policy.actions";
import { SitePtoPoliciesPanel } from "@/components/admin/site-pto-policies-panel";
import { Badge, Card, LinkButton, PageHeader, statusTone } from "@/components/ui";

/**
 * A site, on the design's doc template: header, the site's own settings as
 * label-over-value pairs, then the PTO policy assignments.
 *
 * <p>The design's Site doc draws the settings as an editable field card with a
 * Save Site action. They are read-only here on purpose — the only form that
 * writes a Site is the one in the Sites list, and a second editor for the same
 * six columns is two places for a time zone to be changed. The design's
 * Timeclocks table is left out entirely: this app has no device records, so
 * the card could only be invented.
 */

/** One label-over-value pair, the design's `kv` item. */
function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="wms-label">{label}</span>
      <span
        style={{
          font: "var(--type-body1)",
          fontWeight: "var(--weight-medium)",
          color: "var(--text-primary)",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "SITE_MANAGE")) redirect("/admin");

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
    <div className="flex flex-col gap-4">
      <PageHeader
        title={site.name}
        subtitle={`${site.timezone}${site.address ? ` · ${site.address}` : ""}`}
        actions={
          // Sites has no sidebar entry — it is reached through Company Setup —
          // so this is the only way back to the list.
          <LinkButton href="/admin/sites" hierarchy="tertiary">
            ← Sites
          </LinkButton>
        }
      />

      <div className="flex flex-col gap-4" style={{ maxWidth: 900 }}>
        <Card title="Site" subtitle="Time zone decides how punches are stamped.">
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,30%)),1fr))]">
            <Kv label="Time Zone" value={site.timezone} />
            <Kv label="Address" value={site.address || "—"} />
            <Kv
              label="Status"
              value={
                site.isActive ? (
                  <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                ) : (
                  // statusTone answers "warning" for anything it does not know,
                  // and an amber pill on a site nobody clocks in at reads as
                  // something to go and fix. Neutral is Badge's own default.
                  <Badge size="sm">Inactive</Badge>
                )
              }
            />
          </div>
        </Card>

        <Card
          title="PTO Policy Assignments"
          subtitle="Set the accrual policy for each leave type at this site. Employees without a personal override use this policy."
        >
          <SitePtoPoliciesPanel
            siteId={site.id}
            leaveTypes={leaveTypes}
            policies={ptoPolicies}
            assignments={siteAssignments}
          />
        </Card>
      </div>
    </div>
  );
}
