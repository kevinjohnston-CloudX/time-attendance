import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-zinc-900 dark:text-white">404</h1>
        <p className="mt-2 text-lg text-zinc-600 dark:text-zinc-400">Page not found</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
