"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui";
import { switchedHref } from "@/lib/design-switch";

/**
 * Classic or New, beside the navigation layout control: both are how the
 * product looks, not what it does. Picking Classic opens this same page in the
 * classic design; this site is always New. See lib/design-switch.
 */
export function DesignSwitch({ classicUrl }: { classicUrl: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <>
      <span
        className="whitespace-nowrap uppercase"
        style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", letterSpacing: "0.05em" }}
      >
        Design
      </span>
      <SegmentedControl
        size="sm"
        ariaLabel="Design"
        value="new"
        onChange={(next) => {
          if (next === "classic") window.location.assign(switchedHref(classicUrl, pathname, search.toString()));
        }}
        items={[
          { value: "classic", label: "Classic" },
          { value: "new", label: "New" },
        ]}
      />
    </>
  );
}
