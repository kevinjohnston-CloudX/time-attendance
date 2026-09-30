import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTenantBySlug, toggleTenantActive, enterTenant } from "@/actions/super-admin.actions";
import { format } from "date-fns";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TableFooter,
  THead,
  TBody,
  TR,
  TH,
  TD,
  statusTone,
} from "@/components/ui";

/**
 * One label-over-value pair, as the design's doc template draws them: an
 * uppercase overline over a 16px semibold value, tabular so the two counts
 * line up with each other.
 */
function Kv({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="wms-overline">{label}</span>
      <span
        className="tabular"
        style={{
          font: "var(--weight-semibold) 16px/22px var(--font-sans)",
          color: "var(--text-primary)",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * One tenant, on the design's doc template: the facts as a key/value card,
 * then a card per table.
 *
 * <p>The deactivation banner is not a nicety. "Manage Portal" still works on a
 * deactivated tenant, so without it you can be eight clicks into a company
 * whose staff currently cannot sign in and have nothing on screen saying so.
 */
export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getTenantBySlug(slug);
  if (!result.success) notFound();
  const tenant = result.data;

  async function handleToggle() {
    "use server";
    await toggleTenantActive(tenant.id);
  }

  async function handleEnter() {
    "use server";
    await enterTenant(tenant.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned
        title={tenant.name}
        subtitle={`${tenant.slug} · Created ${format(tenant.createdAt, "MMM d, yyyy")}`}
        actions={
          <>
            {/* Tenants is not in any nav, so this link is the only way back. */}
            <LinkButton href="/super-admin/tenants" hierarchy="tertiary">
              ← Tenants
            </LinkButton>
            <form action={handleEnter}>
              <Button type="submit">Manage Portal →</Button>
            </form>
            <form action={handleToggle}>
              {/* Deactivating a tenant takes a whole company offline, so it
                  is a destructive action and reads as one. */}
              <Button type="submit" hierarchy="secondary" tone={tenant.isActive ? "error" : "regular"}>
                {tenant.isActive ? "Deactivate" : "Activate"}
              </Button>
            </form>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {!tenant.isActive && (
          <Banner
            tone="warning"
            title="This tenant is deactivated"
            body="Its records are all still here and this page still opens them, but nobody at this company can sign in until it is activated again."
          />
        )}

        <Card title="Overview" subtitle="The company record and its totals.">
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))" }}
          >
            <Kv label="Slug" value={<span style={{ fontFamily: "var(--font-mono)" }}>{tenant.slug}</span>} />
            <Kv label="Employees" value={tenant._count.employees} />
            <Kv label="Sites" value={tenant.sites.length} />
            <Kv label="Created" value={format(tenant.createdAt, "MMM d, yyyy")} />
            <Kv
              label="Status"
              value={
                <Badge tone={statusTone(tenant.isActive ? "ACTIVE" : "INACTIVE")} size="sm" dot>
                  {tenant.isActive ? "Active" : "Inactive"}
                </Badge>
              }
            />
          </div>
        </Card>

        <Card title="Sites" subtitle="Each site's time zone sets the time on its punches." padding={0}>
          {tenant.sites.length === 0 ? (
            <EmptyState
              title="No sites"
              body="A tenant with no site cannot take a punch. Add one from the tenant's own admin area."
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Timezone</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {tenant.sites.map((s) => (
                    <TR key={s.id}>
                      <TD style={{ fontWeight: "var(--weight-medium)" }}>{s.name}</TD>
                      <TD style={{ fontFamily: "var(--font-mono)", font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                        {s.timezone}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(s.isActive ? "ACTIVE" : "INACTIVE")} size="sm" dot>
                          {s.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <TableFooter shown={tenant.sites.length} total={tenant.sites.length} label="sites" />
            </>
          )}
        </Card>

        <Card
          title="Employees"
          subtitle="The first twenty by name. Open the tenant's portal for the full list."
          padding={0}
        >
          {tenant.employees.length === 0 ? (
            <EmptyState
              title="No employees"
              body="Only the System Admin created with the tenant would normally be here, so an empty list means that record is missing."
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Username</TH>
                    <TH>Code</TH>
                    <TH>Role</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {tenant.employees.map((e) => (
                    <TR key={e.id}>
                      <TD style={{ fontWeight: "var(--weight-medium)" }}>{e.user.name}</TD>
                      <TD style={{ fontFamily: "var(--font-mono)", font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                        @{e.user.username}
                      </TD>
                      <TD style={{ color: "var(--text-secondary)" }}>{e.employeeCode}</TD>
                      <TD style={{ color: "var(--text-secondary)" }}>{e.role}</TD>
                      <TD>
                        {/* Inactive is checked first: somebody switched off
                            cannot sign in whether they are away or not, so
                            "On Leave" on a deactivated account would be the
                            less useful of two true statements. Both land on
                            the same tone, which is the helper working as
                            intended — they are one severity, not two. */}
                        {!e.isActive ? (
                          <Badge tone={statusTone("INACTIVE")} size="sm">
                            Inactive
                          </Badge>
                        ) : e.onLeave ? (
                          <Badge tone={statusTone("ON_LEAVE")} size="sm" dot>
                            On Leave
                          </Badge>
                        ) : (
                          <Badge tone={statusTone("ACTIVE")} size="sm" dot>
                            Active
                          </Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <TableFooter
                shown={tenant.employees.length}
                total={tenant._count.employees}
                label="employees"
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
