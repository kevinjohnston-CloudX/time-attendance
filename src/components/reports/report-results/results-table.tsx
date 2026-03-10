"use client";

interface Column {
  id: string;
  label: string;
  type: string;
}

function formatMinutesDecimal(mins: number): string {
  return (mins / 60).toFixed(2);
}

function formatCell(value: unknown, type: string): string {
  if (value === null || value === undefined) return "—";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "number" && typeof value === "number") {
    // If it looks like minutes, show decimal hours
    if (value > 0 && value % 1 === 0) return formatMinutesDecimal(value);
    return String(value);
  }
  return String(value);
}

export function ResultsTable({
  columns,
  rows,
  totalRows,
  isLoading,
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
  totalRows: number;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-zinc-400">
        Running report...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-zinc-400">
        No results found
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
        {totalRows.toLocaleString()} row{totalRows !== 1 ? "s" : ""}
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            {rows.map((row, i) => (
              <tr
                key={i}
                className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={`whitespace-nowrap px-4 py-2 text-zinc-700 dark:text-zinc-300 ${
                      col.type === "number" ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {formatCell(row[col.id], col.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
