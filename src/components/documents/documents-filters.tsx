import { Search } from "lucide-react";
import { Button, Select } from "@/components/ui";

/**
 * The search-and-narrow row that sits in the documents toolbar.
 *
 * <p>A plain GET form, so a narrowed list is a URL. "The two 2025 Word forms
 * I still need signed" is a thing one person sends another, and the previous
 * client-side filter had no address to send — it also lost the filter on the
 * reload that follows an upload.
 *
 * <p>The search box is hand-built rather than the kit's SearchInput because
 * that one is controlled and wants an onChange a server component cannot
 * hand it. Its measurements are copied verbatim, so the two read as the same
 * control.
 */
export function DocumentsFilters({
  q,
  type,
  year,
  typeOptions,
  yearOptions,
  placeholder,
}: {
  q: string;
  type: string;
  year: string;
  typeOptions: { value: string; label: string }[];
  yearOptions: number[];
  placeholder: string;
}) {
  return (
    <form method="GET" className="flex flex-wrap items-center gap-2">
      <label
        className="ta-field flex h-8 items-center gap-2 rounded-md px-2.5"
        style={{
          border: "1px solid var(--stroke-default)",
          background: "var(--surface-card)",
          // A width rather than a 260px flex basis: the form wraps, and a
          // wrapping row sizes itself from its items' widths, not their
          // bases, so a basis alone pushed the Filter button onto a line of
          // its own.
          width: 260,
          flex: "0 1 auto",
          minWidth: 160,
        }}
      >
        <Search className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
        <input
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 border-0 bg-transparent outline-none"
          style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}
        />
      </label>

      {/* Both selects are dropped when there is only one value to choose from:
          a filter that cannot change the list is a control that lies about
          what it does. */}
      {typeOptions.length > 1 && (
        <Select name="type" defaultValue={type} aria-label="File type">
          <option value="">All types</option>
          {typeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}

      {yearOptions.length > 1 && (
        <Select name="year" defaultValue={year} aria-label="Year uploaded">
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
