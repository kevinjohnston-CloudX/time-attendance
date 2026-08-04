"use client";

import { useState } from "react";
import { Copy, Check, ChevronDown } from "lucide-react";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={handleCopy} className="rounded p-1 text-zinc-400 hover:text-zinc-200">
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function CodeBlock({ code, lang = "json" }: { code: string; lang?: string }) {
  return (
    <div className="relative mt-2 rounded-lg bg-zinc-900 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-1.5">
        <span className="text-xs text-zinc-500">{lang}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Badge({ method }: { method: "GET" | "POST" }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-bold font-mono ${
      method === "GET"
        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
    }`}>
      {method}
    </span>
  );
}

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</h3>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-5 py-5 dark:border-zinc-800">
          {children}
        </div>
      )}
    </div>
  );
}

function Field({ name, type, required, description }: { name: string; type: string; required?: boolean; description: string }) {
  return (
    <div className="flex gap-3 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-800">
      <div className="w-40 shrink-0">
        <code className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{name}</code>
        {required && <span className="ml-1.5 text-xs text-red-500">required</span>}
      </div>
      <div className="w-24 shrink-0">
        <span className="text-xs text-zinc-400">{type}</span>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
    </div>
  );
}

export function ApiDocumentation() {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://your-domain.com";

  return (
    <div className="max-w-3xl space-y-2">

      {/* Authentication */}
      <Section title="Authentication" defaultOpen>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          All requests must include an API key in the <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">Authorization</code> header.
          Generate keys from the <strong>API Keys</strong> tab.
        </p>
        <CodeBlock lang="http" code={`Authorization: Bearer ta_a1b2c3d4e5f6...`} />
        <p className="mt-2 text-xs text-zinc-400">
          Requests without a valid key receive a <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">401 Unauthorized</code> response.
        </p>
      </Section>

      {/* GET leave-types */}
      <Section title="GET — List Leave Types">
        <div className="flex items-center gap-2">
          <Badge method="GET" />
          <code className="text-sm text-zinc-700 dark:text-zinc-300">/api/external/leave-types</code>
        </div>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Returns all active leave types for your organization. Use the <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">code</code> field
          when submitting PTO requests.
        </p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Example Request</p>
        <CodeBlock lang="http" code={`GET ${baseUrl}/api/external/leave-types
Authorization: Bearer ta_a1b2c3d4...`} />

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Example Response</p>
        <CodeBlock code={`{
  "leaveTypes": [
    {
      "externalCode": 1,
      "name": "Paid Time Off",
      "category": "PTO",
      "requiresApproval": true,
      "isPaid": true
    },
    {
      "externalCode": 2,
      "name": "Sick Leave",
      "category": "SICK",
      "requiresApproval": false,
      "isPaid": true
    }
  ]
}`} />
      </Section>

      {/* POST pto-requests */}
      <Section title="POST — Submit a Leave Request">
        <div className="flex items-center gap-2">
          <Badge method="POST" />
          <code className="text-sm text-zinc-700 dark:text-zinc-300">/api/external/pto-requests</code>
        </div>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Creates a leave request for an employee. The request is created in <strong>DRAFT</strong> status and must be submitted for approval separately, or will follow the leave type&apos;s approval rules.
        </p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Request Body</p>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Either <code className="font-mono">employeeCode</code> or <code className="font-mono">email</code> must be provided — not both are required, but at least one is.
        </p>
        <div className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <Field name="employeeCode" type="string" description="Employee's code. Use this or email — at least one required." />
          <Field name="email" type="string" description="Employee's email address. Use this or employeeCode — at least one required." />
          <Field name="leaveTypeCode" type="integer" required description="Numeric code of the leave type (from /api/external/leave-types)." />
          <Field name="selectedDays" type="array" required description="Array of day objects. Each must include a date and type." />
          <Field name="note" type="string" description="Optional note attached to the request." />
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">selectedDays — Full Day</p>
        <CodeBlock code={`{ "date": "2026-09-01", "type": "FULL" }`} />

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">selectedDays — Partial Day</p>
        <p className="mt-1 text-xs text-zinc-400">
          Duration is auto-calculated from <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">leaveFrom</code> to the employee&apos;s shift end time.
        </p>
        <CodeBlock code={`{ "date": "2026-09-02", "type": "PARTIAL", "leaveFrom": "13:00" }`} />

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Example Request — using employeeCode</p>
        <CodeBlock lang="http" code={`POST ${baseUrl}/api/external/pto-requests
Authorization: Bearer ta_a1b2c3d4...
Content-Type: application/json

{
  "employeeCode": "EMP001",
  "leaveTypeCode": 1,
  "selectedDays": [
    { "date": "2026-09-01", "type": "FULL" },
    { "date": "2026-09-02", "type": "PARTIAL", "leaveFrom": "13:00" }
  ],
  "note": "Family appointment"
}`} />

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Example Request — using email</p>
        <CodeBlock lang="http" code={`POST ${baseUrl}/api/external/pto-requests
Authorization: Bearer ta_a1b2c3d4...
Content-Type: application/json

{
  "email": "john.smith@example.com",
  "leaveTypeCode": 1,
  "selectedDays": [
    { "date": "2026-09-01", "type": "FULL" },
    { "date": "2026-09-02", "type": "PARTIAL", "leaveFrom": "13:00" }
  ],
  "note": "Family appointment"
}`} />

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Example Response — 201 Created</p>
        <CodeBlock code={`{
  "leaveRequestId": "clx1a2b3c4d5e6f7g8h9",
  "status": "DRAFT",
  "durationMinutes": 720
}`} />

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">Error Responses</p>
        <div className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <Field name="401" type="" description="Missing or invalid API key." />
          <Field name="400" type="" description="Validation failed — response includes a details object." />
          <Field name="404" type="" description="Employee or leave type not found." />
        </div>
      </Section>

    </div>
  );
}
