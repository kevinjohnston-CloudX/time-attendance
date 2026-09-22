"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, SearchInput, exceptionTone } from "@/components/ui";

/**
 * The left half of the Exceptions split pane: who has something open.
 *
 * <p>The search is local state rather than a query parameter, unlike every
 * other filter on this screen. It narrows a list the server has already sent
 * in full, so putting it in the URL would mean a round trip per keystroke to
 * hide rows the browser is holding.
 */

interface EmployeeEntry {
  employeeId: string;
  name: string;
  /** Labelled on the server — see the page for why it is not mapped here. */
  exceptionTypes: { value: string; label: string }[];
  count: number;
}

function buildUrl(siteId?: string, departmentId?: string, employeeId?: string, exceptionType?: string, payPeriodId?: string) {
  const params = new URLSearchParams();
  if (siteId) params.set("siteId", siteId);
  if (departmentId) params.set("departmentId", departmentId);
  if (employeeId) params.set("employeeId", employeeId);
  if (exceptionType) params.set("exceptionType", exceptionType);
  if (payPeriodId) params.set("payPeriodId", payPeriodId);
  const qs = params.toString();
  return `/supervisor/exceptions${qs ? `?${qs}` : ""}`;
}

interface Props {
  employees: EmployeeEntry[];
  totalCount: number;
  selectedEmployeeId?: string;
  siteId?: string;
  departmentId?: string;
  exceptionType?: string;
  payPeriodId?: string;
}

export function ExceptionsEmployeeList({
  employees,
  totalCount,
  selectedEmployeeId,
  siteId,
  departmentId,
  exceptionType,
  payPeriodId,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? employees.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    : employees;

  return (
    <>
      <div className="shrink-0 p-2" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search employees…" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {employees.length === 0 ? (
          <p
            className="p-4 text-center"
            style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}
          >
            No exceptions
          </p>
        ) : (
          <>
            {/* "All employees" is a way back out of a selection, so it is only
                in the way while you are searching for one. */}
            {!search.trim() && (
              <Link
                href={buildUrl(siteId, departmentId, undefined, exceptionType, payPeriodId)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 ${
                  selectedEmployeeId ? "hover:bg-[var(--fill-hover)]" : ""
                }`}
                style={{
                  borderBottom: "1px solid var(--stroke-divider)",
                  font: "var(--type-body1)",
                  fontWeight: selectedEmployeeId ? undefined : "var(--weight-medium)",
                  background: selectedEmployeeId ? undefined : "var(--surface-info)",
                  color: selectedEmployeeId ? "var(--text-secondary)" : "var(--text-accent)",
                }}
              >
                All employees
                <Badge size="sm">{totalCount}</Badge>
              </Link>
            )}

            {filtered.length === 0 && (
              <p
                className="p-4 text-center"
                style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}
              >
                No match
              </p>
            )}

            {filtered.map((emp) => {
              const isSelected = emp.employeeId === selectedEmployeeId;
              return (
                <Link
                  key={emp.employeeId}
                  href={buildUrl(siteId, departmentId, emp.employeeId, exceptionType, payPeriodId)}
                  className={`flex w-full flex-col gap-1 px-3 py-2.5 ${
                    isSelected ? "" : "hover:bg-[var(--fill-hover)]"
                  }`}
                  style={{
                    borderBottom: "1px solid var(--stroke-divider)",
                    background: isSelected ? "var(--surface-info)" : undefined,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="truncate"
                      style={{
                        font: "var(--type-body1)",
                        fontWeight: "var(--weight-medium)",
                        color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                      }}
                    >
                      {emp.name}
                    </span>
                    <Badge tone="warning" size="sm">
                      {emp.count}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {emp.exceptionTypes.map((t) => (
                      <Badge key={t.value} tone={exceptionTone(t.value)} size="sm">
                        {t.label}
                      </Badge>
                    ))}
                  </div>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
