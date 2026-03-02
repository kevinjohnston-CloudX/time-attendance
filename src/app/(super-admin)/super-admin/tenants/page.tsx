import Link from "next/link";
import { getTenants } from "@/actions/super-admin.actions";
import { format } from "date-fns";

export default async function TenantsPage() {
  const result = await getTenants();
  const tenants = result.success ? result.data : [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tenants</h1>
          <p className="mt-0.5 text-sm text-zinc-400">
            {tenants.length} tenant{tenants.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/super-admin/tenants/new"
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
        >
          + New Tenant
        </Link>
      </div>

      {tenants.length === 0 ? (
        <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <p className="text-zinc-400">No tenants yet.</p>
          <Link
            href="/super-admin/tenants/new"
            className="mt-4 inline-block text-sm text-white underline"
          >
            Create your first tenant
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Employees</th>
                <th className="px-4 py-3 font-medium">Sites</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950">
              {tenants.map((t) => (
                <tr key={t.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-medium text-white">{t.name}</td>
                  <td className="px-4 py-3 font-mono text-zinc-400">{t.slug}</td>
                  <td className="px-4 py-3 text-zinc-300">{t._count.employees}</td>
                  <td className="px-4 py-3 text-zinc-300">{t._count.sites}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.isActive
                          ? "bg-emerald-900/40 text-emerald-400"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {t.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {format(t.createdAt, "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/super-admin/tenants/${t.slug}`}
                      className="text-zinc-400 hover:text-white"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
