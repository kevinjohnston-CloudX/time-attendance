"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Something went wrong</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{error.message}</p>
        <button
          onClick={reset}
          className="mt-6 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
