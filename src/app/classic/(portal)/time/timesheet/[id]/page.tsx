import { redirect } from "next/navigation";

export default async function TimesheetDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/time/timesheet?id=${id}`);
}
