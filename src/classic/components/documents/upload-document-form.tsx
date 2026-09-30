"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, CheckCircle, Search } from "lucide-react";
import { uploadDocument } from "@/actions/document.actions";

interface Employee {
  id: string;
  user: { name: string | null };
}

interface Props {
  employees: Employee[];
}

export function UploadDocumentForm({ employees }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Employee typeahead
  const [query, setQuery] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = query.length === 0
    ? employees.slice(0, 8)
    : employees
        .filter((e) => (e.user.name ?? "").toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current &&
        !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectEmployee(emp: Employee) {
    setSelectedEmployee(emp);
    setQuery(emp.user.name ?? "");
    setShowDropdown(false);
  }

  function reset() {
    setTitle("");
    setFile(null);
    setError(null);
    setSuccess(false);
    setQuery("");
    setSelectedEmployee(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEmployee) { setError("Please select an employee."); return; }
    if (!file) { setError("Please select a file."); return; }
    setError(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("employeeId", selectedEmployee.id);
    fd.append("title", title);

    startTransition(async () => {
      const res = await uploadDocument(fd);
      if (res.success) {
        setSuccess(true);
        reset();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setSuccess(false); setError(null); }}
        className="flex shrink-0 items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
      >
        <Upload className="h-4 w-4" />
        Upload Document
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Upload Document</h2>
        <button
          onClick={() => { setOpen(false); reset(); }}
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {success && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Document uploaded successfully.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

          {/* Employee typeahead */}
          <div className="relative">
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Employee
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedEmployee(null);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search by name…"
                autoComplete="off"
                className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
            </div>
            {showDropdown && filtered.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
              >
                {filtered.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    onMouseDown={() => selectEmployee(emp)}
                    className="w-full px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50 dark:text-white dark:hover:bg-zinc-700 first:rounded-t-lg last:rounded-b-lg"
                  >
                    {emp.user.name ?? emp.id}
                  </button>
                ))}
              </div>
            )}
            {query.length > 0 && !selectedEmployee && filtered.length === 0 && (
              <p className="mt-1 text-xs text-zinc-400">No employees found.</p>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Document Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q1 2025 Pay Stub"
              required
              maxLength={200}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>

          {/* File */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              File <span className="font-normal">(PDF, JPG, PNG, DOC — max 10 MB)</span>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-zinc-500 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:file:text-zinc-300"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col justify-end gap-1">
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); reset(); }}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending || !selectedEmployee}
                className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
              >
                {isPending ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
