import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createTenant } from "@/actions/super-admin.actions";
import { Banner, Button, Card, Input, LinkButton, PageHeader, Select } from "@/components/ui";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
];

/**
 * The design's field grid: columns collapse rather than shrink past 200px,
 * which is the width at which "America/Los_Angeles" stops being readable in a
 * select. 96 rather than 100 leaves room for the 12px gap.
 */
function fieldGrid(cols: number) {
  return `repeat(auto-fit, minmax(min(100%, max(200px, ${(96 / cols).toFixed(0)}%)), 1fr))`;
}

/**
 * `Select` from the kit is the bare control — it has no label, because in a
 * list toolbar the surrounding row says what it filters. In a form it needs
 * one, and it has to be the same 12px medium as `Input`'s or the two sit at
 * different heights in the same grid row.
 */
function SelectField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={htmlFor} className="wms-label">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Creating a tenant, on the design's doc template: a back link and the submit
 * in the header, then the form as a stack of labelled cards in a single
 * column.
 *
 * <p>One transaction stands behind this form and it creates six things — the
 * tenant, its first site, a General department, a Default rule set, a user and
 * that user's System Admin employee record. The cards are grouped the way the
 * transaction is, so a half-filled form is obviously half-filled.
 */
export default async function NewTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = (await searchParams) ?? {};

  async function handleCreate(formData: FormData) {
    "use server";
    const result = await createTenant({
      name: formData.get("name") as string,
      slug: formData.get("slug") as string,
      siteName: formData.get("siteName") as string,
      siteTimezone: formData.get("siteTimezone") as string,
      adminName: formData.get("adminName") as string,
      adminUsername: formData.get("adminUsername") as string,
      adminPassword: formData.get("adminPassword") as string,
      adminEmployeeCode: formData.get("adminEmployeeCode") as string,
    });
    if (result.success) {
      redirect(`/super-admin/tenants/${result.data.slug}`);
    }
    // Errors would ideally show in the form; for now redirect back
    redirect("/super-admin/tenants/new?error=1");
  }

  return (
    <form action={handleCreate} className="flex flex-col gap-4">
      <PageHeader pinned
        title="New Tenant"
        subtitle="Creates the tenant, its first site, a default rule set and a System Admin who can sign in."
        actions={
          <>
            <LinkButton href="/super-admin/tenants" hierarchy="tertiary">
              ← Tenants
            </LinkButton>
            <Button type="submit" hierarchy="primary">
              Create Tenant
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4" style={{ maxWidth: 840 }}>
        {error && (
          // The action throws the reason away on its way back here, so this
          // says what is actually checkable rather than guessing: both of the
          // uniqueness constraints it can trip are deployment-wide.
          <Banner
            tone="error"
            title="Nothing was created"
            body="The slug and the admin username must each be unique across every tenant on this deployment. Change whichever one is already taken and submit again."
          />
        )}

        <Card title="Tenant" subtitle="The company record. Its sites, employees and rules belong to it.">
          <div className="grid gap-3" style={{ gridTemplateColumns: fieldGrid(2) }}>
            <Input name="name" label="Company Name" required placeholder="Bergen Logistics LLC" />
            <Input
              name="slug"
              label="Slug"
              required
              pattern="[a-z0-9-]+"
              placeholder="bergen-logistics"
              hint="Lowercase letters, numbers and hyphens. It appears in URLs and cannot be changed later."
            />
          </div>
        </Card>

        <Card title="First Site" subtitle="The site's time zone sets the time on its punches.">
          <div className="grid gap-3" style={{ gridTemplateColumns: fieldGrid(2) }}>
            <Input name="siteName" label="Site Name" required placeholder="Main Office" />
            <SelectField label="Timezone" htmlFor="siteTimezone">
              <Select
                id="siteTimezone"
                name="siteTimezone"
                defaultValue="America/New_York"
                style={{ width: "100%" }}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </Select>
            </SelectField>
          </div>
        </Card>

        <Card
          title="System Admin User"
          subtitle="The first person who can sign in and set everything else up."
        >
          <div className="grid gap-3" style={{ gridTemplateColumns: fieldGrid(2) }}>
            <Input name="adminName" label="Full Name" required placeholder="Jane Smith" />
            <Input name="adminEmployeeCode" label="Employee Code" required placeholder="ADMIN001" />
            <Input name="adminUsername" label="Username" required minLength={3} placeholder="jsmith" />
            <Input
              name="adminPassword"
              label="Password"
              type="password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              hint="Give this to them yourself. It is not sent by email."
            />
          </div>
        </Card>
      </div>
    </form>
  );
}
