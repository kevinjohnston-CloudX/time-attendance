import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getEffectiveRole } from "@/lib/rbac/check-permission";
import {
  IdCard,
  Network,
  ShieldCheck,
  ScrollText,
  Building2,
  CalendarClock,
  PartyPopper,
  SlidersHorizontal,
  Receipt,
  MessageCircle,
  CalendarRange,
  Palmtree,
  FileText,
  Hourglass,
  Plug,
  RefreshCw,
  DatabaseZap,
  Settings,
  Users,
  Warehouse,
  Scale,
  CalendarOff,
  Cpu,
} from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ADMIN_GROUPS } from "@/components/layout/nav-model";
import { AdminHub, type HubGroup } from "./admin-hub";

/**
 * Every setting in the product, grouped.
 *
 * <p>The list itself lives in the nav model, because the ⌘K palette offers
 * the same destinations and a second copy here is a second copy to keep in
 * step. This page only decides what each one looks like.
 */
const ICONS: Record<string, React.ReactNode> = {
  "/admin/employees": <IdCard className="h-[18px] w-[18px]" />,
  "/admin/site-settings?tab=departments": <Network className="h-[18px] w-[18px]" />,
  "/admin/roles": <ShieldCheck className="h-[18px] w-[18px]" />,
  "/admin/audit": <ScrollText className="h-[18px] w-[18px]" />,
  "/admin/site-settings?tab=sites": <Building2 className="h-[18px] w-[18px]" />,
  "/admin/rules-setup?tab=shifts": <CalendarClock className="h-[18px] w-[18px]" />,
  "/admin/site-settings?tab=holidays": <PartyPopper className="h-[18px] w-[18px]" />,
  "/admin/rules-setup?tab=rule-sets": <SlidersHorizontal className="h-[18px] w-[18px]" />,
  "/admin/site-settings?tab=pay-codes": <Receipt className="h-[18px] w-[18px]" />,
  "/admin/site-settings?tab=reason-codes": <MessageCircle className="h-[18px] w-[18px]" />,
  "/payroll/pay-periods": <CalendarRange className="h-[18px] w-[18px]" />,
  "/admin/site-settings?tab=leave-types": <Palmtree className="h-[18px] w-[18px]" />,
  "/admin/rules-setup?tab=leave-policies": <FileText className="h-[18px] w-[18px]" />,
  "/accruals": <Hourglass className="h-[18px] w-[18px]" />,
  "/admin/api-keys": <Plug className="h-[18px] w-[18px]" />,
  "/admin/adp": <RefreshCw className="h-[18px] w-[18px]" />,
  "/admin/wms-sync": <DatabaseZap className="h-[18px] w-[18px]" />,
};

/**
 * The glyph for each area in the hub's "Settings areas" card.
 *
 * <p>Keyed by group label rather than by index so reordering ADMIN_GROUPS, or
 * adding a sixth area, cannot silently shuffle the icons onto the wrong rows.
 */
const GROUP_ICONS: Record<string, React.ReactNode> = {
  "People & HR": <Users className="h-[18px] w-[18px]" />,
  Organization: <Warehouse className="h-[18px] w-[18px]" />,
  "Pay & Rules": <Scale className="h-[18px] w-[18px]" />,
  "Leave & Absence": <CalendarOff className="h-[18px] w-[18px]" />,
  System: <Cpu className="h-[18px] w-[18px]" />,
};

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const effectiveRole = await getEffectiveRole(session.user);

  const groups: HubGroup[] = ADMIN_GROUPS.map((g) => ({
    label: g.label,
    hint: g.hint,
    icon: GROUP_ICONS[g.label] ?? <Settings className="h-[18px] w-[18px]" />,
    items: g.items
      .filter((i) => hasPermission(effectiveRole, i.permission as Parameters<typeof hasPermission>[1]))
      .map((i) => ({
        label: i.label,
        detail: i.detail,
        href: i.href,
        icon: ICONS[i.href] ?? <Settings className="h-[18px] w-[18px]" />,
      })),
  })).filter((g) => g.items.length > 0);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) redirect("/dashboard");

  return (
    <div className="flex flex-col gap-4">
      {/* The count moved into the areas card and the filter row, where it is
          next to the thing it counts. The subtitle says how the page is
          organised instead, which is the question someone arriving here asks. */}
      <PageHeader pinned
        title="Administration"
        subtitle="Manage people, policies and company settings"
      />
      <AdminHub groups={groups} />
    </div>
  );
}
