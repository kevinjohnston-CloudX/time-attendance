"use client";

import { useEffect, useRef, useState, type ElementType } from "react";
import { ArrowLeft, Building2, CalendarDays, FolderOpen, Layers, MessageSquare, Palmtree, Receipt, Tag } from "lucide-react";
import { LinkButton, PageHeader, PinnedBar } from "@/components/ui";
import { SitesManager } from "@/components/admin/sites-manager";
import { DepartmentsManager } from "@/components/admin/departments-manager";
import { HolidaysManager } from "@/components/admin/holidays-manager";
import { LeaveTypesManager } from "@/components/admin/leave-types-manager";
import { PayCodesManager } from "@/components/admin/pay-codes-manager";
import { ReasonCodesManager } from "@/components/admin/reason-codes-manager";
import { PayCategoriesManager } from "@/components/admin/pay-categories-manager";
import { PayTypesManager } from "@/components/admin/pay-types-manager";
import type { Site, Department } from "@prisma/client";

/**
 * Company Setup: eight lists behind one screen, laid out like Exceptions.
 * A pinned header, the areas down a rail on the left in three groups with
 * how many active records each holds, and the open area filling the rest.
 *
 * <p>The open area is React state, mirrored into `?tab=` with
 * history.replaceState, so a reload or a copied link opens the same area
 * without switching areas ever refetching: the server component above loads
 * all eight in one round. Which areas show is decided by the permissions
 * the page was given; each area's actions check them again.
 */

type DepartmentWithSites = Department & { sites: { site: Site }[] };

type Tab = "sites" | "departments" | "holidays" | "leave-types" | "pay-codes" | "reason-codes" | "pay-categories" | "pay-types";

interface AreaDef {
  id: Tab;
  label: string;
  icon: ElementType;
  requires: "site" | "rules" | "payroll";
}

const GROUPS: { title: string; areas: AreaDef[] }[] = [
  {
    title: "Organization",
    areas: [
      { id: "sites", label: "Sites", icon: Building2, requires: "site" },
      { id: "departments", label: "Departments", icon: FolderOpen, requires: "site" },
    ],
  },
  {
    title: "Time off",
    areas: [
      { id: "holidays", label: "Holidays", icon: CalendarDays, requires: "rules" },
      { id: "leave-types", label: "Leave types", icon: Palmtree, requires: "rules" },
    ],
  },
  {
    title: "Payroll",
    areas: [
      { id: "pay-categories", label: "Pay categories", icon: Layers, requires: "rules" },
      { id: "pay-types", label: "Pay types", icon: Tag, requires: "rules" },
      { id: "pay-codes", label: "Pay codes", icon: Receipt, requires: "payroll" },
      { id: "reason-codes", label: "Reason codes", icon: MessageSquare, requires: "payroll" },
    ],
  },
];

interface Props {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  sites: any[];
  departments: any[];
  holidays: any[];
  leaveTypes: any[];
  payCodes: any[];
  reasonCodes: any[];
  ptoPolicies: any[];
  holidayRules: any[];
  payCategories: any[];
  payTypes: any[];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  hasSiteManage: boolean;
  hasRulesManage: boolean;
  hasPayPeriodManage: boolean;
  initialTab?: string;
}

export function SiteSettingsClient(props: Props) {
  const { hasSiteManage, hasRulesManage, hasPayPeriodManage, initialTab } = props;
  const allowed = (r: AreaDef["requires"]) =>
    (r === "site" && hasSiteManage) || (r === "rules" && hasRulesManage) || (r === "payroll" && hasPayPeriodManage);
  const groups = GROUPS.map((g) => ({ ...g, areas: g.areas.filter((a) => allowed(a.requires)) })).filter((g) => g.areas.length);
  const areas = groups.flatMap((g) => g.areas);

  const [active, setActive] = useState<Tab>(() =>
    areas.some((a) => a.id === initialTab) ? (initialTab as Tab) : (areas[0]?.id ?? "sites"),
  );

  function pick(id: Tab) {
    setActive(id);
    window.history.replaceState(window.history.state, "", `/admin/site-settings?tab=${id}`);
  }

  const activeCount: Record<Tab, number> = {
    sites: props.sites.filter((x) => x.isActive).length,
    departments: props.departments.filter((x) => x.isActive).length,
    holidays: props.holidays.filter((x) => x.isActive).length,
    "leave-types": props.leaveTypes.filter((x) => x.isActive).length,
    "pay-categories": props.payCategories.filter((x) => x.isActive).length,
    "pay-types": props.payTypes.filter((x) => x.isActive).length,
    "pay-codes": props.payCodes.filter((x) => x.isActive).length,
    "reason-codes": props.reasonCodes.filter((x) => x.isActive).length,
  };

  // The rail pins just under the header and reaches the bottom of the window.
  const barRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [rail, setRail] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const bar = barRef.current;
      const el = railRef.current;
      if (!bar || !el) return;
      if (!window.matchMedia("(min-width: 1024px) and (min-height: 600px)").matches) return setRail(null);
      // At rest the rail sits 4px under the bar: the bar's 12px bottom
      // padding comes back as a -12px margin, then the 16px gap.
      const top = Math.round(bar.getBoundingClientRect().height) + 4;
      const height = Math.max(280, Math.floor(window.innerHeight - Math.max(el.getBoundingClientRect().top, top + 40) - 24));
      setRail((prev) => (prev && prev.top === top && prev.height === height ? prev : { top, height }));
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onChange) : null;
    if (barRef.current) ro?.observe(barRef.current);
    document.addEventListener("scroll", onChange, { capture: true, passive: true });
    window.addEventListener("resize", onChange, { passive: true });
    return () => {
      ro?.disconnect();
      document.removeEventListener("scroll", onChange, { capture: true });
      window.removeEventListener("resize", onChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <PinnedBar barRef={barRef}>
        <PageHeader
          title="Company Setup"
          subtitle="Sites, departments, holidays and the codes payroll uses"
          actions={
            <LinkButton href="/admin" hierarchy="tertiary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
              Administration
            </LinkButton>
          }
        />
      </PinnedBar>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <nav
          ref={railRef}
          aria-label="Setup areas"
          className="ta-card ta-scroll w-full flex-none overflow-y-auto lg:sticky lg:w-[248px]"
          style={{
            top: rail?.top,
            maxHeight: rail?.height,
            borderRadius: "var(--radius-l)",
          }}
        >
          {groups.map((g, i) => (
            <div
              key={g.title}
              className="flex flex-col gap-0.5 px-2 py-2.5"
              style={i ? { borderTop: "1px solid var(--stroke-divider)" } : undefined}
            >
              <span className="wms-overline px-2.5 pb-1 pt-0.5">{g.title}</span>
              {g.areas.map((a) => (
                <AreaLink key={a.id} area={a} count={activeCount[a.id]} selected={a.id === active} onPick={() => pick(a.id)} />
              ))}
            </div>
          ))}
        </nav>

        <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
          <AreaBody tab={active} {...props} />
        </div>
      </div>
    </div>
  );
}

function AreaLink({ area, count, selected, onPick }: { area: AreaDef; count: number; selected: boolean; onPick: () => void }) {
  const Icon = area.icon;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={selected ? "page" : undefined}
      className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left ${selected ? "" : "ta-hoverable"}`}
      style={{
        border: 0,
        cursor: "pointer",
        background: selected ? "var(--surface-info)" : "transparent",
      }}
    >
      <Icon
        className="h-4 w-4 flex-none"
        style={{ color: selected ? "var(--icon-accent)" : "var(--icon-tertiary)" }}
        aria-hidden="true"
      />
      <span
        className="min-w-0 flex-1 truncate"
        style={{
          font: "var(--type-body1)",
          fontWeight: selected ? "var(--weight-semibold)" : "var(--weight-medium)",
          color: selected ? "var(--text-accent)" : "var(--text-primary)",
        }}
      >
        {area.label}
      </span>
      <span
        className="tabular flex-none"
        title={`${count} active`}
        style={{ font: "var(--type-caption1)", color: selected ? "var(--text-accent)" : "var(--text-tertiary)" }}
      >
        {count}
      </span>
    </button>
  );
}

function AreaBody({ tab, ...p }: Props & { tab: Tab }) {
  switch (tab) {
    case "sites":
      return <SitesManager sites={p.sites as Site[]} />;
    case "departments":
      return <DepartmentsManager departments={p.departments as DepartmentWithSites[]} sites={p.sites as Site[]} />;
    case "holidays":
      return <HolidaysManager holidays={p.holidays} holidayRules={p.holidayRules} />;
    case "leave-types":
      return <LeaveTypesManager leaveTypes={p.leaveTypes} payCodes={p.payCodes} />;
    case "pay-categories":
      return <PayCategoriesManager categories={p.payCategories} ptoPolicies={p.ptoPolicies} leaveTypes={p.leaveTypes} />;
    case "pay-types":
      return <PayTypesManager payTypes={p.payTypes} />;
    case "pay-codes":
      return <PayCodesManager payCodes={p.payCodes} />;
    case "reason-codes":
      return <ReasonCodesManager reasonCodes={p.reasonCodes} />;
  }
}
