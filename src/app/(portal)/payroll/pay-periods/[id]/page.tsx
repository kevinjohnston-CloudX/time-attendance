import { redirect } from "next/navigation";

export default async function PayPeriodDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/payroll/pay-periods?id=${id}`);
}
