import { PageSpinner } from "@/components/layout/page-spinner";

// The first paint while a page streams in, for both designs. It imports no
// style sheet on purpose: see PageSpinner.
export default function Loading() {
  return <PageSpinner />;
}
