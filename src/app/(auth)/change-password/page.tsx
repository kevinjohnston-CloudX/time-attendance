"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { changePassword } from "@/actions/password.actions";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const result = await changePassword(password, confirm);
    setLoading(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    // Sign out so the new session (without mustChangePassword) starts fresh
    await signOut({ redirect: false });
    router.push("/login");
  }

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-800 p-8 shadow-lg">
      <div className="mb-8 text-center">
        <img src="/logo.jpg" alt="Logo" className="mx-auto mb-3 h-12 w-12 rounded object-contain" />
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Change your password</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          You must set a new password before continuing.
        </p>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-4 mb-2">
        Requirements: 8+ characters, uppercase letter, number, special character.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            New password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-500"
            placeholder="At least 8 characters"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="confirm" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-500"
            placeholder="Re-enter password"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-lg bg-zinc-900 dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-50"
        >
          {loading ? "Saving…" : "Set new password"}
        </button>
      </form>
    </div>
  );
}
