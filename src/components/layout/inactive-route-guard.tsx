"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "@/components/layout/navigation-progress";

const ALLOWED_PREFIXES = ["/time/timesheet", "/time/history", "/documents"];

export function InactiveRouteGuard({ isInactive }: { isInactive: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isInactive) return;
    const allowed = ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
    if (!allowed) router.replace("/time/timesheet");
  }, [isInactive, pathname, router]);

  return null;
}
