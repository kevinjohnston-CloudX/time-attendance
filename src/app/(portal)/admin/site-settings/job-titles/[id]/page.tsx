import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getJobTitles } from "@/actions/job-title.actions";
import { EditJobTitleClient } from "./edit-job-title-client";

export default async function EditJobTitlePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const { id } = await params;
  const result = await getJobTitles();
  const jobTitles = result.success ? result.data : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobTitle = (jobTitles as any[]).find((jt) => jt.id === id);
  if (!jobTitle) redirect("/admin/site-settings?tab=job-titles");

  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=job-titles" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Job Titles
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Edit Job Title</h1>
      <EditJobTitleClient jobTitle={serialize(jobTitle)} />
    </div>
  );
}
