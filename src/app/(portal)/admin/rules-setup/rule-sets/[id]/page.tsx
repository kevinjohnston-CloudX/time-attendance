import { notFound, redirect } from "next/navigation";
import { SESSION_ENDED_HREF } from "@/lib/auth.config";
import { auth } from "@/lib/auth";
import { manageOrView } from "@/lib/rbac/check-permission";
import { ViewOnly } from "@/components/admin/setup/view-only";
import { getRuleSet } from "@/actions/admin.actions";
import { getAllPayCodes } from "@/actions/pay-code.actions";
import { RuleSetEditor } from "@/components/admin/rule-set-editor";

/**
 * One rule set's editor. The rule set is read inside the caller's company,
 * so an id from another company, or one that does not exist, is a 404.
 */
export default async function RuleSetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(SESSION_ENDED_HREF);
  // Rule Sets on Read opens it to look at, with nothing to change.
  const access = await manageOrView(session.user, "RULES_MANAGE", "RULES_VIEW");
  if (!access) redirect("/dashboard");

  const { id } = await params;
  const [ruleSet, payCodes] = await Promise.all([getRuleSet({ ruleSetId: id }), getAllPayCodes()]);
  if (!ruleSet.success) notFound();

  // Dates and JSON columns cross to the client as plain values.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return (
    <ViewOnly on={access === "view"}>
      <RuleSetEditor ruleSet={plain(ruleSet.data)} payCodes={plain(payCodes.success ? payCodes.data : [])} />
    </ViewOnly>
  );
}
