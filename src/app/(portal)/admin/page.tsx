import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { Users, Building2, FolderOpen, Calendar, Settings, FileText, RefreshCw } from "lucide-react";

const adminCards = [
  { label: "Employees", href: "/admin/employees", icon: Users, perm: "EMPLOYEE_MANAGE" },
  { label: "Sites", href: "/admin/sites", icon: Building2, perm: "SITE_MANAGE" },
  { label: "Departments", href: "/admin/departments", icon: FolderOpen, perm: "SITE_MANAGE" },
  { label: "Leave Types", href: "/admin/leave-types", icon: Calendar, perm: "RULES_MANAGE" },
  { label: "Rule Sets", href: "/admin/rules", icon: Settings, perm: "RULES_MANAGE" },
  { label: "ADP Sync", href: "/admin/adp", icon: RefreshCw, perm: "EMPLOYEE_MANAGE" },
  { label: "Audit Log", href: "/admin/audit", icon: FileText, perm: "AUDIT_VIEW" },
] as const;

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const visibleCards = adminCards.filter((c) =>
    hasPermission(session.user!.role, c.perm)
  );

  if (visibleCards.length === 0) redirect("/dashboard");

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Admin</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {visibleCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
          >
            <card.icon className="h-6 w-6 text-zinc-400" />
            <span className="font-medium text-zinc-900 dark:text-white">{card.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
