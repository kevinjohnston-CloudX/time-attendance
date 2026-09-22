"use client";

import { useState } from "react";
import { setTemporaryPassword } from "@/actions/password.actions";

interface Props {
  employeeId: string;
}

export function EmployeePasswordPanel({ employeeId }: Props) {
  const [tempPassword, setTempPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    const result = await setTemporaryPassword(employeeId, tempPassword);
    setStatus(result.success ? "done" : "error");
    setMessage(result.message);
    if (result.success) setTempPassword("");
  }

  return (
    <div className="mt-6 rounded-xl border border-[var(--stroke-secondary)] p-5 space-y-3">
      <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Password / Account Access</h3>
      <p className="text-sm text-[var(--text-secondary)]">
        Set a temporary password. The employee will be required to change it on first login.
      </p>
      <p className="text-xs text-[var(--text-tertiary)]">
        Requirements: 8+ characters, uppercase letter, number, special character.
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={tempPassword}
          onChange={(e) => setTempPassword(e.target.value)}
          placeholder="Temporary password (min. 8 chars)"
          minLength={8}
          required
          className="flex-1 rounded-lg border border-[var(--stroke-default)] bg-white dark:bg-zinc-700 px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--stroke-accent)] focus:shadow-[var(--focus-ring-tight)]"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-lg bg-[var(--fill-accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--fill-accent-hover)] disabled:opacity-50"
        >
          {status === "loading" ? "Saving…" : "Set"}
        </button>
      </form>
      {message && (
        <p className={`text-sm ${status === "error" ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
