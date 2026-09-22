import { MissedPunchForm } from "@/components/time/missed-punch-form";

/**
 * The route is a server component and the whole screen is the form.
 *
 * <p>The design's document template puts the primary action in the page
 * header, and "Submit Request" has to know whether the request is in flight —
 * so the header travels with the form rather than sitting above it as a server
 * shell that cannot see the pending state.
 *
 * <p>Nothing is fetched or guarded here. Who may file a missed punch is
 * decided by requestMissedPunch's RBAC guard, which is where it was decided
 * before.
 */
export default function MissedPunchPage() {
  return <MissedPunchForm />;
}
