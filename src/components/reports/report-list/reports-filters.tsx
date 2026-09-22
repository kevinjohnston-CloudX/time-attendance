import { Search } from "lucide-react";
import { Button, Select } from "@/components/ui";

/**
 * The search-and-narrow row that sits in the reports toolbar.
 *
 * <p>A plain GET form, so a narrowed list is a URL. "The three exception
 * reports Dana owns" is a thing one person sends another, and a client-side
 * filter has no address to send.
 *
 * <p>The search box is hand-built rather than the kit's SearchInput because
 * that one is controlled and wants an onChange a server component cannot hand
 * it. Its measurements are copied verbatim, so the two read as one control.
 *
 * <p>The folder rides along as a hidden field: a GET form submits only its own
 * inputs, so without it, searching inside a folder would quietly throw you
 * back out to every report in the tenant.
 */
export function ReportsFilters({
  q,
  type,
  year,
  folder,
  typeOptions,
  yearOptions,
}: {
  q: string;
  type: string;
  year: string;
  folder: string;
  typeOptions: { value: string; label: string }[];
  yearOptions: number[];
}) {
  return (
    <form method="GET" className="flex flex-wrap items-center gap-2">
      {folder && <input type="hidden" name="folder" value={folder} />}

      <label
        className="ta-field flex h-8 items-center gap-2 rounded-md px-2.5"
        style={{
          border: "1px solid var(--stroke-default)",
          background: "var(--surface-card)",
          flex: "0 1 260px",
          minWidth: 160,
        }}
      >
        <Search className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
        <input
          name="q"
          defaultValue={q}
          placeholder="Report, description or owner"
          aria-label="Search reports"
          className="min-w-0 flex-1 border-0 bg-transparent outline-none"
          style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}
        />
      </label>

      {/* Both selects are dropped when there is only one value to choose from:
          a filter that cannot change the list is a control that lies about
          what it does. */}
      {typeOptions.length > 1 && (
        <Select name="type" defaultValue={type} aria-label="Data source">
          <option value="">All types</option>
          {typeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}

      {yearOptions.length > 1 && (
        <Select name="year" defaultValue={year} aria-label="Year last updated">
          <option value="">All years</option>
          {yearOptions.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </Select>
      )}

      <Button type="submit" hierarchy="secondary">
        Filter
      </Button>
    </form>
  );
}
