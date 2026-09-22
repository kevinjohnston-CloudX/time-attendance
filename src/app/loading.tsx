export default function Loading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--surface-page)" }}
    >
      <span
        className="h-8 w-8 animate-spin rounded-full"
        style={{
          border: "3px solid var(--stroke-secondary)",
          borderTopColor: "var(--fill-accent)",
        }}
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
