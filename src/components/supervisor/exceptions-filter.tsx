"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";

/**
 * The scope controls for the Exceptions screen: which pay period, which site,
 * which department.
 *
 * <p>The exception *type* used to be a fourth dropdown here and is now the
 * chip row above the list — same query parameter, same values, but a type you
 * can see and take off in one click rather than one you have to open a select
 * to discover.
 *
 * <p>These sit in the page header rather than in a filter card because the
 * pane below them is height-bound: it scrolls its two halves independently, so
 * every row above it comes straight out of the list of people.
 */

type Site = { id: string; name: string };
type Department = { id: string; name: string };
type PayPeriodOption = { id: string; label: string };

type Props = {
  sites: Site[];
  departments: Department[];
  payPeriods: PayPeriodOption[];
  selectedSiteId?: string;
  selectedDepartmentId?: string;
  selectedExceptionType?: string;
  selectedPayPeriodId?: string;
};

export function ExceptionsFilter({
  sites,
  departments,
  payPeriods,
  selectedSiteId,
  selectedDepartmentId,
  selectedExceptionType,
  selectedPayPeriodId,
}: Props) {
  const router = useRouter();

  function navigate(
    siteId?: string,
    departmentId?: string,
    exceptionType?: string,
    payPeriodId?: string,
  ) {
    const params = new URLSearchParams();
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    if (exceptionType) params.set("exceptionType", exceptionType);
    if (payPeriodId) params.set("payPeriodId", payPeriodId);
    const qs = params.toString();
    router.push(`/supervisor/exceptions${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {payPeriods.length > 0 && (
        <Select
          aria-label="Pay period"
          value={selectedPayPeriodId ?? ""}
          onChange={(e) =>
            navigate(selectedSiteId, selectedDepartmentId, selectedExceptionType, e.target.value || undefined)
          }
        >
          <option value="">All Pay Periods</option>
          {payPeriods.map((pp) => (
            <option key={pp.id} value={pp.id}>{pp.label}</option>
          ))}
        </Select>
      )}
      {sites.length > 0 && (
        <Select
          aria-label="Site"
          value={selectedSiteId ?? ""}
          // Departments are listed per site, so the one that was picked may
          // not exist under the new site — dropping it beats filtering to a
          // department this site does not have and reading that as "clean".
          onChange={(e) =>
            navigate(e.target.value || undefined, undefined, selectedExceptionType, selectedPayPeriodId)
          }
        >
          <option value="">All Sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      )}
      <Select
        aria-label="Department"
        value={selectedDepartmentId ?? ""}
        onChange={(e) =>
          navigate(selectedSiteId, e.target.value || undefined, selectedExceptionType, selectedPayPeriodId)
        }
      >
        <option value="">All Departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </Select>
    </div>
  );
}
