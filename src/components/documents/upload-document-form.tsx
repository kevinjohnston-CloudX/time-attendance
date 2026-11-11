"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Upload } from "lucide-react";
import { uploadDocument } from "@/actions/document.actions";
import { MAX_FILE_SIZE_BYTES } from "@/lib/validators/document.schema";
import { Banner, Button, Input } from "@/components/ui";
import styles from "./documents.module.css";
import { Window, WindowCard } from "@/components/ui/window";
import { FileWell, fileSize } from "@/components/ui/file-well";

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

  // Escape closes the typeahead first, then the window. A click on the X or
  // the scrim has already closed the typeahead on its mousedown.
  function onWindowClose() {
    if (showDropdown) setShowDropdown(false);
    else closeModal();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEmployee) { setError("Choose the employee this document is for."); return; }
    if (!file) { setError("Choose a file to upload."); return; }
    // Checked here too: a file over the limit never reaches the server, which
    // refuses the whole request, so it can only be answered from here.
    if (file.size > MAX_FILE_SIZE_BYTES) { setError("That file is over the 4 MB limit. Choose a smaller one."); return; }
    setError(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("employeeId", selectedEmployee.id);
    fd.append("title", title);

    startTransition(async () => {
      // A request the server refused outright (too large, connection lost)
      // used to drop the page to the error screen.
      const res = await uploadDocument(fd).catch(() => ({ success: false as const, error: "The upload did not go through. Check the file and try again." }));
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
        className="ta-header-primary"
        leadingIcon={<Upload className="h-4 w-4" />}
        onClick={() => { setOpen(true); setSuccess(false); setError(null); }}
      >
        Upload
      </Button>

      {open && (
        <Window
          icon={<Upload />}
          title="Upload document"
          subtitle="It appears on the employee's own Documents page straight away."
          size="sm"
          busy={isPending}
          onClose={onWindowClose}
          onSubmit={handleSubmit}
          foot="PDF, JPG, PNG or Word, up to 4 MB."
          actions={
            <>
              <Button type="button" hierarchy="secondary" onClick={closeModal} disabled={isPending}>
                {success ? "Close" : "Cancel"}
              </Button>
              <Button pending={isPending} type="submit" disabled={isPending || !selectedEmployee || !file}>
                {isPending ? "Uploading…" : "Upload document"}
              </Button>
            </>
          }
        >
          {success && <Banner tone="success" body="Document uploaded. Add another, or close this window." />}
          {error && <Banner tone="error" body={error} />}

          <WindowCard padded>
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
                placeholder="Search by name"
                autoComplete="off"
                leadingIcon={<Search className="h-4 w-4" />}
                hint={query.length > 0 && !selectedEmployee && filtered.length === 0 ? "No employees found." : undefined}
              />

              {showDropdown && filtered.length > 0 && (
                <div
                  className={`ta-modal absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-lg ${styles.suggest}`}
                  style={{ border: "1px solid var(--stroke-secondary)" }}
                >
                  {filtered.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      // mousedown, not click: the input's blur would tear the
                      // list down before a click ever landed on it.
                      onMouseDown={() => selectEmployee(emp)}
                      className="ta-hoverable w-full truncate px-3 py-2 text-left first:rounded-t-lg last:rounded-b-lg"
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
              placeholder="For example: Pay stub, March"
            />

            <FileWell
              label="File"
              required
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              fileName={file?.name ?? null}
              detail={file ? fileSize(file.size) : "Or drop it here"}
              inputRef={fileRef}
              onFile={setFile}
            />
          </WindowCard>
        </Window>
      )}
    </>
  );
}

