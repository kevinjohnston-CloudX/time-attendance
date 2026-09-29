import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import Link from "next/link";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") redirect("/dashboard");

  return (
    /*
     * Pinned to the design system's dark theme with data-theme, rather than
     * hand-rolled from zinc.
     *
     * <p>Super-admin is deliberately dark — it is how you know you are in the
     * area that can act across every tenant. Before, that was a second,
     * separate dark palette that happened to look similar to the real one and
     * drifted from it. Setting data-theme="dark" makes every semantic token
     * flip, so this area is the product in dark mode rather than a lookalike,
     * and it stays correct when the dark tokens change.
     */
    <div data-theme="dark" className="min-h-screen" style={{ background: "var(--surface-page)", color: "var(--text-primary)" }}>
      <header style={{ background: "var(--surface-card)", borderBottom: "1px solid var(--stroke-secondary)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <span
              className="uppercase"
              style={{ font: "var(--type-overline)", letterSpacing: "0.12em", color: "var(--text-tertiary)" }}
            >
              Super Admin
            </span>
            <nav className="flex gap-4">
              <Link
                href="/super-admin/tenants"
                className="ta-hoverable rounded-md px-2 py-1"
                style={{ font: "var(--type-button1)", color: "var(--text-secondary)", textDecoration: "none" }}
              >
                Tenants
              </Link>
            </nav>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="ta-hoverable rounded-md px-2 py-1"
              style={{ font: "var(--type-button1)", color: "var(--text-secondary)" }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* The pinned page titles reach into this padding, not the portal's. */}
      <main
        className="mx-auto max-w-6xl px-6 py-8"
        style={{ ["--pin-x" as string]: "1.5rem", ["--pin-t" as string]: "2rem", ["--pin-bg" as string]: "var(--surface-page)" }}
      >
        {children}
      </main>
    </div>
  );
}
