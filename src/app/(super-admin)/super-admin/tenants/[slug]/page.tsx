import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantBySlug, toggleTenantActive, enterTenant } from "@/actions/super-admin.actions";
import { format } from "date-fns";

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
    <div>
      <Link
        href="/super-admin/tenants"
        className="text-sm text-zinc-500 hover:text-white"
      >
        ← Tenants
      </Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{tenant.name}</h1>
          <p className="mt-0.5 text-sm text-zinc-400">
            <span className="font-mono">{tenant.slug}</span> · Created{" "}
            {format(tenant.createdAt, "MMM d, yyyy")} ·{" "}
            <span
              className={
                tenant.isActive ? "text-emerald-400" : "text-zinc-500"
              }
            >
              {tenant.isActive ? "Active" : "Inactive"}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <form action={handleEnter}>
            <button
              type="submit"
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100"
            >
              Manage Portal →
            </button>
          </form>
          <form action={handleToggle}>
            <button
              type="submit"
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
            >
              {tenant.isActive ? "Deactivate" : "Activate"}
            </button>
          </form>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-400">Employees</p>
          <p className="mt-1 text-2xl font-bold text-white">
            {tenant._count.employees}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-400">Sites</p>
          <p className="mt-1 text-2xl font-bold text-white">
            {tenant.sites.length}
          </p>
        </div>
      </div>

      {/* Sites */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-white">Sites</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Timezone</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950">
              {tenant.sites.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-white">{s.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.timezone}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.isActive
                          ? "bg-emerald-900/40 text-emerald-400"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {s.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Employees */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-white">
          Employees
          {tenant._count.employees > 20 && (
            <span className="ml-2 text-sm font-normal text-zinc-400">
              (showing first 20 of {tenant._count.employees})
            </span>
          )}
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950">
              {tenant.employees.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 text-white">{e.user.name}</td>
                  <td className="px-4 py-3 font-mono text-zinc-400">
                    @{e.user.username}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{e.employeeCode}</td>
                  <td className="px-4 py-3 text-zinc-300">{e.role}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        e.isActive
                          ? "bg-emerald-900/40 text-emerald-400"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {e.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
