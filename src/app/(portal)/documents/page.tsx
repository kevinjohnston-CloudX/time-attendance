import { FileText } from "lucide-react";

export default function DocumentsPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <FileText className="h-12 w-12 text-zinc-300 dark:text-zinc-700" />
      <h1 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-white">
        Documents
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Document management is not yet configured for your account.
      </p>
    </div>
  );
}
