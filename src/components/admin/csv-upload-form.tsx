"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkCreateEmployees } from "@/actions/admin.actions";
import { Upload, Download, FileSpreadsheet, X } from "lucide-react";
import type { CsvEmployeeRow } from "@/lib/validators/admin.schema";

interface Props {
  sites: string[];
  departments: string[];
  ruleSets: string[];
}

const CSV_HEADERS = [
  "name",
  "username",
  "password",
  "employeeCode",
  "email",
  "role",
  "site",
  "department",
  "ruleSet",
  "hireDate",
  "supervisorCode",
] as const;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsv(text: string): { rows: CsvEmployeeRow[]; parseErrors: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return { rows: [], parseErrors: ["CSV must have a header row and at least one data row."] };
  }

  const headerFields = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ""));
  const parseErrors: string[] = [];

  // Verify required headers
  const missing = CSV_HEADERS.filter(
    (h) => !headerFields.includes(h.toLowerCase())
  );
  if (missing.length > 0) {
    return { rows: [], parseErrors: [`Missing CSV columns: ${missing.join(", ")}`] };
  }

  const colIndex = Object.fromEntries(
    CSV_HEADERS.map((h) => [h, headerFields.indexOf(h.toLowerCase())])
  ) as Record<(typeof CSV_HEADERS)[number], number>;

  const rows: CsvEmployeeRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < headerFields.length) {
      parseErrors.push(`Row ${i + 1}: expected ${headerFields.length} columns, got ${fields.length}`);
      continue;
    }

    rows.push({
      name: fields[colIndex.name] ?? "",
      username: fields[colIndex.username] ?? "",
      password: fields[colIndex.password] ?? "",
      employeeCode: fields[colIndex.employeeCode] ?? "",
      email: fields[colIndex.email] ?? "",
      role: (fields[colIndex.role] ?? "EMPLOYEE") || "EMPLOYEE",
      site: fields[colIndex.site] ?? "",
      department: fields[colIndex.department] ?? "",
      ruleSet: fields[colIndex.ruleSet] ?? "",
      hireDate: fields[colIndex.hireDate] ?? "",
      supervisorCode: fields[colIndex.supervisorCode] ?? "",
    } as CsvEmployeeRow);
  }

  return { rows, parseErrors };
}

export function CsvUploadForm({ sites, departments, ruleSets }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<CsvEmployeeRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [result, setResult] = useState<{
    created: number;
    errors: { row: number; message: string }[];
  } | null>(null);

  function downloadTemplate() {
    const site = sites[0] ?? "Main Office";
    const dept = departments[0] ?? "Engineering";
    const rs = ruleSets[0] ?? "Default";

    const header = CSV_HEADERS.join(",");
    const example1 = `John Smith,jsmith,Temp1234!,EMP001,jsmith@acme.com,EMPLOYEE,${site},${dept},${rs},2024-03-15,`;
    const example2 = `Jane Doe,jdoe,Temp1234!,EMP002,jdoe@acme.com,SUPERVISOR,${site},${dept},${rs},2023-01-10,EMP001`;
    const csv = [header, example1, example2].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employee-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const { rows, parseErrors: errs } = parseCsv(reader.result as string);
      setParsedRows(rows);
      setParseErrors(errs);
    };
    reader.readAsText(file);
  }

  function handleUpload() {
    if (parsedRows.length === 0) return;
    setResult(null);

    startTransition(async () => {
      const res = await bulkCreateEmployees({ rows: parsedRows });
      if (res.success) {
        setResult(res.data);
        if (res.data.created > 0) {
          router.refresh();
        }
      } else {
        setResult({ created: 0, errors: [{ row: 0, message: res.error }] });
      }
    });
  }

  function reset() {
    setFileName(null);
    setParsedRows([]);
    setParseErrors([]);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <Upload className="h-4 w-4" />
        Import CSV
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
          Import Employees from CSV
        </h3>
        <button
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={downloadTemplate}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Download className="h-3.5 w-3.5" />
          Download Template
        </button>

        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Choose File
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {fileName && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {fileName}
          </span>
        )}
      </div>

      {/* Parse errors */}
      {parseErrors.length > 0 && (
        <div className="mt-3 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">Parse errors:</p>
          <ul className="mt-1 list-inside list-disc text-sm text-red-600 dark:text-red-400">
            {parseErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Preview */}
      {parsedRows.length > 0 && parseErrors.length === 0 && !result && (
        <div className="mt-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Ready to import <span className="font-semibold">{parsedRows.length}</span> employee
            {parsedRows.length !== 1 && "s"}.
          </p>
          <button
            onClick={handleUpload}
            disabled={isPending}
            className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {isPending ? "Importing…" : "Upload & Create"}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-3">
          {result.created > 0 && (
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              Successfully created {result.created} employee{result.created !== 1 && "s"}.
            </p>
          )}
          {result.errors.length > 0 && (
            <div className="mt-2 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">Errors:</p>
              <ul className="mt-1 list-inside list-disc text-sm text-red-600 dark:text-red-400">
                {result.errors.map((err, i) => (
                  <li key={i}>
                    {err.row > 0 && `Row ${err.row}: `}
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={reset}
            className="mt-3 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Upload another file
          </button>
        </div>
      )}
    </div>
  );
}
