import { RouteSkeleton } from "@/components/layout/route-skeleton";

// Every portal page without its own loading screen: the shape of the kind of
// page that is coming, inside the shell. See RouteSkeleton.
export default function Loading() {
  return <RouteSkeleton />;
}
