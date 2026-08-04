"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, KeyRound, AlertTriangle } from "lucide-react";
import { createApiKey, revokeApiKey, regenerateApiKey } from "@/actions/api-key.actions";
import { format } from "date-fns";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
};

interface Props { apiKeys: ApiKey[] }

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const btnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={handleCopy} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export function ApiKeysManager({ apiKeys: initial }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealedName, setRevealedName] = useState<string>("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createApiKey({ name: newName.trim() });
      if (!result.success) { setError(result.error); return; }
      setRevealedKey(result.data.fullKey);
      setRevealedName(newName.trim());
      setNewName("");
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleRevoke(id: string, name: string) {
    if (!confirm(`Revoke key "${name}"? Any integration using it will immediately lose access.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await revokeApiKey({ apiKeyId: id });
      if (!result.success) { setError(result.error); return; }
      router.refresh();
    });
  }

  function handleRegenerate(id: string, name: string) {
    if (!confirm(`Regenerate key "${name}"? The existing key will stop working immediately.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await regenerateApiKey({ apiKeyId: id });
      if (!result.success) { setError(result.error); return; }
      setRevealedKey(result.data.fullKey);
      setRevealedName(name);
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
      )}

      {/* Revealed key modal — shown once after generation */}
      {revealedKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <KeyRound className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-white">API key created</h3>
                <p className="text-sm text-zinc-500">{revealedName}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Copy this key now — it will not be shown again.
              </p>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
              <code className="flex-1 break-all text-xs text-zinc-700 dark:text-zinc-300">{revealedKey}</code>
              <CopyButton value={revealedKey} />
            </div>

            <div className="mt-5 flex justify-end">
              <button onClick={() => setRevealedKey(null)} className={btnCls}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Key list */}
      <div className="flex flex-col gap-2">
        {initial.length === 0 && !showCreate && (
          <p className="py-8 text-center text-sm text-zinc-400">No API keys yet.</p>
        )}
        {initial.map((key) => (
          <div key={key.id} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`font-medium text-sm ${key.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400"}`}>
                {key.name}
              </span>
              <code className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {key.keyPrefix}
              </code>
              {!key.isActive && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Revoked</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <div className="text-right">
                <p className="text-xs text-zinc-400">Created {format(new Date(key.createdAt), "MMM d, yyyy")}</p>
                {key.lastUsedAt && (
                  <p className="text-xs text-zinc-400">Last used {format(new Date(key.lastUsedAt), "MMM d, yyyy")}</p>
                )}
                {!key.lastUsedAt && key.isActive && (
                  <p className="text-xs text-zinc-400">Never used</p>
                )}
              </div>
              {key.isActive && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRegenerate(key.id, key.name)}
                    disabled={isPending}
                    className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={() => handleRevoke(key.id, key.name)}
                    disabled={isPending}
                    className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    Revoke
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showCreate ? (
        <form onSubmit={handleCreate} className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-zinc-500">Key name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. WMS Integration"
              required
              autoFocus
              className={inputCls}
            />
          </div>
          <button type="submit" disabled={isPending} className={btnCls}>
            {isPending ? "Generating…" : "Generate"}
          </button>
          <button type="button" onClick={() => { setShowCreate(false); setNewName(""); }} className={cancelBtnCls}>
            Cancel
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-3 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
        >
          + Generate New Key
        </button>
      )}
    </div>
  );
}
