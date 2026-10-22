import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { enterTenant, getTenants } from "@/actions/super-admin.actions";
import { lastCompany } from "@/lib/super-admin/enter-company";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  statusTone,
} from "@/components/ui";

/**
 * Where a super admin lands with no company open. With a last company they
 * go straight back into it (the open-last route sets the company cookie,
 * which a page cannot). The first time, a plain list to open one from:
 * creating a company is not offered here, only under Manage tenants.
 *
 * <p>`?pick=1` is the open-last route saying there is no last company, so
 * this page never sends the browser back to it.
 */
export default async function SuperAdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ pick?: string }>;
}) {
  const session = await auth();
  const { pick } = await searchParams;
  if (!pick && session?.user?.id && (await lastCompany(session.user.id))) redirect("/super-admin/open-last");

  const result = await getTenants();
  const tenants = result.success ? result.data : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        pinned
        title="Select tenant"
        subtitle="Open a company to work in it. The next sign in opens it again by itself."
        actions={
          <LinkButton href="/super-admin/tenants" hierarchy="secondary">
            Manage tenants
          </LinkButton>
        }
      />

      <Card padding={0}>
        {tenants.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No tenants yet"
            body="A tenant is one company. Create the first one under Manage tenants."
            action={
              <LinkButton href="/super-admin/tenants" size="sm">
                Manage tenants
              </LinkButton>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Tenant</TH>
                <TH numeric>Employees</TH>
                <TH>Status</TH>
                <TH align="right">
                  <span className="sr-only">Open</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {tenants.map((t) => (
                <TR key={t.id}>
                  <TD style={{ fontWeight: "var(--weight-medium)" }}>
                    <span className="block min-w-0 truncate">{t.name}</span>
                  </TD>
                  <TD numeric style={{ color: "var(--text-secondary)" }}>{t._count.employees}</TD>
                  <TD>
                    <Badge tone={statusTone(t.isActive ? "ACTIVE" : "INACTIVE")} size="sm" dot>
                      {t.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TD>
                  <TD align="right">
                    <form action={enterTenant.bind(null, t.id)}>
                      <Button type="submit" size="sm">
                        Open
                      </Button>
                    </form>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
