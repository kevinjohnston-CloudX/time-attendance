import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Sidebar
        role={session.user.role ?? "EMPLOYEE"}
        userName={session.user.name}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
