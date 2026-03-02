import Link from "next/link";
import { redirect } from "next/navigation";
import { createTenant } from "@/actions/super-admin.actions";

export default function NewTenantPage() {
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
    <div className="max-w-xl">
      <Link
        href="/super-admin/tenants"
        className="text-sm text-zinc-500 hover:text-white"
      >
        ← Tenants
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-white">New Tenant</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Creates a tenant, first site, default rule set, and a System Admin user.
      </p>

      <form action={handleCreate} className="mt-6 space-y-6">
        {/* Tenant */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Tenant</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Company Name
              </label>
              <input
                name="name"
                required
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                placeholder="Bergen Logistics LLC"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Slug <span className="text-zinc-500">(lowercase, hyphens only)</span>
              </label>
              <input
                name="slug"
                required
                pattern="[a-z0-9-]+"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                placeholder="bergen-logistics"
              />
            </div>
          </div>
        </section>

        {/* Site */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">First Site</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Site Name
              </label>
              <input
                name="siteName"
                required
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                placeholder="Main Office"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Timezone
              </label>
              <select
                name="siteTimezone"
                defaultValue="America/New_York"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
              >
                <option value="America/New_York">Eastern (ET)</option>
                <option value="America/Chicago">Central (CT)</option>
                <option value="America/Denver">Mountain (MT)</option>
                <option value="America/Los_Angeles">Pacific (PT)</option>
                <option value="America/Anchorage">Alaska (AKT)</option>
                <option value="Pacific/Honolulu">Hawaii (HT)</option>
              </select>
            </div>
          </div>
        </section>

        {/* System Admin */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">System Admin User</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Full Name
              </label>
              <input
                name="adminName"
                required
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Employee Code
              </label>
              <input
                name="adminEmployeeCode"
                required
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                placeholder="ADMIN001"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Username
              </label>
              <input
                name="adminUsername"
                required
                minLength={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                placeholder="jsmith"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Password
              </label>
              <input
                name="adminPassword"
                type="password"
                required
                minLength={8}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                placeholder="min 8 characters"
              />
            </div>
          </div>
        </section>

        <button
          type="submit"
          className="w-full rounded-lg bg-white py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100"
        >
          Create Tenant
        </button>
      </form>
    </div>
  );
}
