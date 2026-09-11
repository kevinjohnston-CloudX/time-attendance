import { redirect } from "next/navigation";

export default async function OldEmployeeAccrualsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/accruals/${id}`);
}
