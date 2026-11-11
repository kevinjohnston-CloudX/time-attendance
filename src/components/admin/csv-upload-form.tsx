"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkCreateEmployees } from "@/actions/admin.actions";
import { CircleAlert, Download, FileSpreadsheet, Upload } from "lucide-react";
import type { CsvEmployeeRow } from "@/lib/validators/admin.schema";
import { Banner, Button } from "@/components/ui";
import { Window, WindowBlock, WindowCard } from "@/components/ui/window";
import { FileWell } from "@/components/ui/file-well";
import styles from "./csv-upload-form.module.css";

interface Props {
  sites: string[];
  departments: string[];
  ruleSets: string[];
}

const CSV_HEADERS = [
  "name",
  "employeeCode",
  "email",
  "workEmail",
  "role",
  "customRole",
  "site",
  "department",
  "ruleSet",
  "hireDate",
  "supervisorCode",
  "wmsId",
  "payType",
  "payRate",
  "language",
] as const;

// workEmail is new: a file from before it still imports.
const OPTIONAL_HEADERS = new Set<string>(["workEmail", "customRole", "payType", "payRate", "language"]);
const REQUIRED_HEADERS = CSV_HEADERS.filter((h) => !OPTIONAL_HEADERS.has(h));

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
    return { rows: [], parseErrors: ["The file needs a header row and at least one employee under it."] };
  }

  const headerFields = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ""));
  const parseErrors: string[] = [];

  // Verify required headers (customRole is optional)
  const missing = REQUIRED_HEADERS.filter(
    (h) => !headerFields.includes(h.toLowerCase())
  );
  if (missing.length > 0) {
    return { rows: [], parseErrors: [`These columns are missing: ${missing.join(", ")}. Start from the template.`] };
  }

  const colIndex = Object.fromEntries(
    CSV_HEADERS.map((h) => [h, headerFields.indexOf(h.toLowerCase())])
  ) as Record<(typeof CSV_HEADERS)[number], number>;

  const rows: CsvEmployeeRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < headerFields.length) {
      parseErrors.push(`Row ${i + 1} has ${fields.length} columns instead of ${headerFields.length}.`);
      continue;
    }

    rows.push({
      name: fields[colIndex.name] ?? "",
      employeeCode: fields[colIndex.employeeCode] ?? "",
      email: fields[colIndex.email] ?? "",
      workEmail: colIndex.workEmail >= 0 ? (fields[colIndex.workEmail] ?? "") : "",
      role: (fields[colIndex.role] ?? "EMPLOYEE") || "EMPLOYEE",
      customRole: colIndex.customRole >= 0 ? (fields[colIndex.customRole] ?? "") : "",
      site: fields[colIndex.site] ?? "",
      department: fields[colIndex.department] ?? "",
      ruleSet: fields[colIndex.ruleSet] ?? "",
      hireDate: fields[colIndex.hireDate] ?? "",
      supervisorCode: fields[colIndex.supervisorCode] ?? "",
      wmsId: fields[colIndex.wmsId] ?? "",
      payType: colIndex.payType >= 0 ? (fields[colIndex.payType] ?? "") : "",
      payRate: colIndex.payRate >= 0 ? (fields[colIndex.payRate] ?? "") : "",
      language: colIndex.language >= 0 ? (fields[colIndex.language] ?? "") : "",
    } as unknown as CsvEmployeeRow);
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
    const example1 = `John Smith,EMP001,jsmith@gmail.com,john.smith@acme.com,EMPLOYEE,,${site},${dept},${rs},2024-03-15,,B001,HOURLY,25.00,Spanish`;
    const example2 = `Jane Doe,EMP002,,jane.doe@acme.com,EMPLOYEE,MyCustomRole,${site},${dept},${rs},2023-01-10,EMP001,B002,SALARY,65000,`;
    const csv = [header, example1, example2].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employee-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFile(file: File) {
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

  function closeModal() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <Button
        hierarchy="secondary"
        onClick={() => setOpen(true)}
        leadingIcon={<Upload className="h-4 w-4" aria-hidden="true" />}
      >
        Import CSV
      </Button>

      {open && (
        <Window
          icon={<FileSpreadsheet />}
          title="Import employees"
          subtitle="Add many employees at once from a spreadsheet saved as CSV."
          size="sm"
          busy={isPending}
          onClose={closeModal}
          foot={
            result
              ? null
              : parseErrors.length
                ? "Fix the file and choose it again."
                : parsedRows.length
                  ? `Ready to import ${employeesWord(parsedRows.length)}.`
                  : "Nothing is imported until you choose Import."
          }
          footTone={!result && parseErrors.length ? "error" : undefined}
          actions={
            result ? (
              <>
                <Button hierarchy="secondary" onClick={reset}>
                  Import another file
                </Button>
                <Button onClick={closeModal}>Done</Button>
              </>
            ) : (
              <>
                <Button hierarchy="secondary" onClick={closeModal} disabled={isPending}>
                  Cancel
                </Button>
                <Button
                  pending={isPending}
                  leadingIcon={<Upload className="h-4 w-4" aria-hidden="true" />}
                  onClick={handleUpload}
                  disabled={isPending || parsedRows.length === 0 || parseErrors.length > 0}
                >
                  {isPending ? "Importing…" : parsedRows.length && !parseErrors.length ? `Import ${employeesWord(parsedRows.length)}` : "Import"}
                </Button>
              </>
            )
          }
        >
          {result && <Banner tone={result.created > 0 ? "success" : "error"} body={`${created(result.created)}.`} />}

          <WindowCard>
            <WindowBlock label="Template" note="Start from the template so the columns are in the order CloudTime reads.">
              <span>
                <Button hierarchy="secondary" size="sm" leadingIcon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={downloadTemplate}>
                  Download template
                </Button>
              </span>
            </WindowBlock>
            <WindowBlock>
              <FileWell
                label="File"
                accept=".csv"
                icon={<FileSpreadsheet />}
                fileName={fileName}
                detail={fileName ? (parsedRows.length ? employeesWord(parsedRows.length) : parseErrors.length ? "Could not be read" : "Reading the file") : "A CSV file, or drop it here"}
                inputRef={fileRef}
                onFile={handleFile}
              />
            </WindowBlock>
          </WindowCard>

          {(parseErrors.length > 0 || (result && result.errors.length > 0)) && (
            <WindowCard>
              <WindowBlock
                label={
                  result
                    ? `${rowsWord(result.errors.length)} could not be imported`
                    : `${rowsWord(parseErrors.length)} could not be read`
                }
              >
                <ul className={`${styles.problems} ta-scroll`}>
                  {(result ? result.errors.map((e) => (e.row > 0 ? `Row ${e.row}: ${e.message}` : e.message)) : parseErrors).map((msg, i) => (
                    <li key={i} className={styles.problem}>
                      <CircleAlert aria-hidden="true" />
                      <span>{msg}</span>
                    </li>
                  ))}
                </ul>
              </WindowBlock>
            </WindowCard>
          )}
        </Window>
      )}
    </>
  );
}

function employeesWord(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "employee" : "employees"}`;
}
function rowsWord(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"}`;
}
function created(n: number): string {
  return n === 0 ? "No employees were created" : `${employeesWord(n)} created`;
}
