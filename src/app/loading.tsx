export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-white" />
    </div>
  );
}
