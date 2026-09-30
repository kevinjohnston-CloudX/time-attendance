import { getTenants } from "@/actions/super-admin.actions";
import { format } from "date-fns";
import { Building2 } from "lucide-react";
import {
  Badge,
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
  Toolbar,
  statusTone,
} from "@/components/ui";

/**
 * Every company on this deployment, as the design's list template lays it out:
 * header and its one action, the record count, then the table in a bare card.
 *
 * <p>The count is above the table as well as under it because this is the one
 * screen where "nothing here" is ambiguous — a failed `getTenants` returns an
 * empty list rather than throwing, and an empty list of tenants and a
 * super-admin check that just refused look identical without a number.
 */
export default async function TenantsPage() {
  const result = await getTenants();
  const tenants = result.success ? result.data : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned
        title="Tenants"
        subtitle="Super-admin · every company on this deployment"
        actions={
          <LinkButton href="/super-admin/tenants/new" hierarchy="primary">
            Create Tenant
          </LinkButton>
        }
      />

      <Toolbar count={tenants.length} countLabel="tenant" />

      <Card padding={0}>
        {tenants.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No tenants yet"
            body="A tenant is one company. Its sites, employees and rules all belong to it."
            action={
              <LinkButton href="/super-admin/tenants/new" size="sm">
                Create the first tenant
              </LinkButton>
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Tenant</TH>
                  <TH>Slug</TH>
                  <TH numeric>Employees</TH>
                  <TH numeric>Sites</TH>
                  <TH>Created</TH>
                  <TH>Status</TH>
                  <TH align="right">
                    <span className="sr-only">Open</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {tenants.map((t) => (
                  <TR key={t.id}>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{t.name}</TD>
                    {/* The slug is typed into URLs and config, so it reads in
                        monospace like every other identifier in the product. */}
                    <TD
                      style={{
                        fontFamily: "var(--font-mono)",
                        font: "var(--type-body2)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {t.slug}
                    </TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>{t._count.employees}</TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>{t._count.sites}</TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {format(t.createdAt, "MMM d, yyyy")}
                    </TD>
                    <TD>
                      {/* Deactivated is amber rather than grey on purpose: it
                          means an entire company cannot sign in, which is a
                          state to notice, not a quiet default. */}
                      <Badge tone={statusTone(t.isActive ? "ACTIVE" : "INACTIVE")} size="sm" dot>
                        {t.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    <TD align="right">
                      <LinkButton href={`/super-admin/tenants/${t.slug}`} size="sm" hierarchy="link">
                        View →
                      </LinkButton>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter shown={tenants.length} total={tenants.length} label="tenants" />
          </>
        )}
      </Card>
    </div>
  );
}
