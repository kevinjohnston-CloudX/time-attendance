"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "@/components/layout/navigation-progress";
import { Select } from "@/components/ui";

type Option = { id: string; label: string };

/**
 * A Dashboard choice kept in the address, so a reload or a shared link opens
 * the same view. Changing one keeps the others: picking a pay period no
 * longer drops the building, and the other way round.
 */
function ParamSelect({
  param,
  options,
  selectedId,
  ariaLabel,
}: {
  param: string;
  options: Option[];
  selectedId: string;
  ariaLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  return (
    <Select
      aria-label={ariaLabel}
      value={selectedId}
      onChange={(e) => {
        const params = new URLSearchParams(search.toString());
        params.set(param, e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      style={{ maxWidth: 260 }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function OverviewPeriodFilter({ options, selectedId }: { options: Option[]; selectedId: string }) {
  return <ParamSelect param="overviewPeriodId" options={options} selectedId={selectedId} ariaLabel="Pay period" />;
}

/** The building the Dashboard's company-wide cards count, or every building. */
export function BuildingFilter({ options, selectedId }: { options: Option[]; selectedId: string }) {
  return <ParamSelect param="site" options={options} selectedId={selectedId} ariaLabel="Building" />;
}
