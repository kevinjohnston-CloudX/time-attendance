"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setupPasswordFromToken } from "@/actions/password.actions";

function SetupPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <p className="text-sm text-red-500 text-center">
        Invalid link. Please request a new invite email.
      </p>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const result = await setupPasswordFromToken(token, password);
    setLoading(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push("/login"), 2000);
  }

  if (success) {
    return (
      <p className="text-sm text-green-600 dark:text-green-400 text-center">
        Password set! Redirecting to sign in…
      </p>
    );
  }

  return (
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
        {loading ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}

export default function SetupPasswordPage() {
  return (
    <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-800 p-8 shadow-lg">
      <div className="mb-8 text-center">
        <img src="/logo.jpg" alt="Logo" className="mx-auto mb-3 h-12 w-12 rounded object-contain" />
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Set your password</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Choose a password to complete your account setup.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-400 text-center">Loading…</p>}>
        <SetupPasswordForm />
      </Suspense>
    </div>
  );
}
