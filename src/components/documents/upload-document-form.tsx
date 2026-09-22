"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, Search } from "lucide-react";
import { uploadDocument } from "@/actions/document.actions";
import { Banner, Button, Input } from "@/components/ui";

interface Employee {
  id: string;
  user: { name: string | null };
}

interface Props {
  employees: Employee[];
}

/**
 * Upload, the documents screen's page action.
 *
 * <p>It opens a dialog rather than unfolding in place. This component is
 * passed to PageHeader as an action, so the expanded four-column form used to
 * render inside the header's action row — a form squeezed against the right
 * edge under the title, pushing the page action off screen on a laptop.
 *
 * <p>Everything the form sends is unchanged: the same FormData keys, the same
 * server action, the same "who is this for" guard before it is called.
 */
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
  const pickerRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = query.length === 0
    ? employees.slice(0, 8)
    : employees
        .filter((e) => (e.user.name ?? "").toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10);

  // Close the typeahead on an outside click. The whole picker is the boundary
  // — the input, its label and the list — so a click on the field's own label
  // does not count as leaving it.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
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

  function closeModal() {
    setOpen(false);
    reset();
  }

  // Escape closes the dialog, or the typeahead first if that is what is open.
  // Deliberately re-bound on every render: the handler has to read the current
  // showDropdown, and a dependency list here would only name every function it
  // calls and re-run anyway.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (showDropdown) setShowDropdown(false);
      else closeModal();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  });

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
        // Clear first, then raise the flag: reset() switches `success` off, so
        // the old order set it and immediately unset it in the same batch and
        // the confirmation never appeared. The dialog stays open because these
        // arrive in batches, and that banner is the only thing that says the
        // last one landed.
        reset();
        setSuccess(true);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <Button
        hierarchy="primary"
        leadingIcon={<Upload className="h-4 w-4" />}
        onClick={() => { setOpen(true); setSuccess(false); setError(null); }}
      >
        Upload
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <div
            aria-hidden="true"
            onClick={closeModal}
            className="fixed inset-0"
            // The design system's own scrim, not a hand-mixed one: a modal
            // that dims the page a different amount from every other modal is
            // the sort of thing nobody names but everybody notices.
            style={{ background: "var(--wms-overlay-modal)" }}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-document-title"
            className="ta-modal relative w-full max-w-[520px] rounded-2xl"
          >
            <header
              className="flex items-center justify-between gap-3 px-4 py-3.5"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2
                  id="upload-document-title"
                  style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}
                >
                  Upload Document
                </h2>
                <p style={{ margin: 0, font: "var(--type-subtitle)", color: "var(--text-secondary)" }}>
                  It appears on that employee&apos;s own Documents page straight away.
                </p>
              </div>
              <Button hierarchy="tertiary" size="sm" iconOnly onClick={closeModal} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </header>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 p-4">
              {success && <Banner tone="success" body="Document uploaded." />}
              {error && <Banner tone="error" body={error} />}

              <div ref={pickerRef} className="relative">
                <Input
                  label="Employee"
                  required
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedEmployee(null);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search by name…"
                  autoComplete="off"
                  leadingIcon={<Search className="h-4 w-4" />}
                  hint={
                    query.length > 0 && !selectedEmployee && filtered.length === 0
                      ? "No employees found."
                      : undefined
                  }
                />

                {showDropdown && filtered.length > 0 && (
                  <div
                    className="ta-modal absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-lg"
                    style={{ border: "1px solid var(--stroke-secondary)" }}
                  >
                    {filtered.map((emp) => (
                      <button
                        key={emp.id}
                        type="button"
                        // mousedown, not click: the input's blur would tear the
                        // list down before a click ever landed on it.
                        onMouseDown={() => selectEmployee(emp)}
                        className="ta-hoverable w-full px-3 py-2 text-left first:rounded-t-lg last:rounded-b-lg"
                        style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}
                      >
                        {emp.user.name ?? emp.id}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Input
                label="Document title"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q1 2025 Pay Stub"
              />

              <div className="flex w-full flex-col gap-1.5">
                <label
                  htmlFor="document-file"
                  style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}
                >
                  File
                  <span aria-hidden="true" style={{ color: "var(--text-error)", marginLeft: 3 }}>
                    *
                  </span>
                </label>
                <input
                  id="document-file"
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  required
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-tertiary)] file:px-3 file:py-1.5 file:text-[var(--text-primary)] hover:file:bg-[var(--fill-hover)]"
                  style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}
                />
                <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                  PDF, JPG, PNG or Word — max 10 MB.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-0.5">
                <Button type="button" hierarchy="secondary" onClick={closeModal}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending || !selectedEmployee}>
                  {isPending ? "Uploading…" : "Upload"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
