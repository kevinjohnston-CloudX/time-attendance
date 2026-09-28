import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { CreateRuleSetClient } from "./create-rule-set-client";

export default async function NewRuleSetPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const hasRulesManage = await userHasPermission(session.user, "RULES_MANAGE");
  if (!hasRulesManage) redirect("/dashboard");

  const payCodesResult = await getAllPayCodes();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/admin/rules-setup?tab=rule-sets"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Rule Sets
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        New Rule Set
      </h1>
      <CreateRuleSetClient
        payCodes={serialize(payCodesResult.success ? payCodesResult.data : [])}
      />
    </div>
  );
}
