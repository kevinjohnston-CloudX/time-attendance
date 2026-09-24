"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { LIST_COOKIE } from "./employees-list-cookie";

/**
 * The Employees list only keeps its search for a trip into a record and back.
 * The moment the viewer lands anywhere outside the list and its records, the
 * saved search is dropped, so opening Employees later starts fresh.
 */
export function EmployeesListForget() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === "/admin/employees" || pathname.startsWith("/admin/employees/")) return;
    try {
      document.cookie = `${LIST_COOKIE}=; path=/admin/employees; max-age=0; samesite=lax`;
    } catch {}
  }, [pathname]);
  return null;
}
