import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getRunPayrollOptions } from "@/actions/payroll-run.actions";
import { RunPayrollScreen } from "@/components/payroll/run-payroll-screen";
import { parseRunCodes, RUN_CODES_COOKIE } from "@/lib/payroll/run-codes";

export default async function RunPayrollPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PAYROLL_RUN")) redirect("/dashboard");

  const result = await getRunPayrollOptions();
  if (!result.success) redirect("/dashboard");

  const savedCodes = parseRunCodes((await cookies()).get(RUN_CODES_COOKIE)?.value);
  return <RunPayrollScreen {...result.data} savedCodes={savedCodes} />;
}
