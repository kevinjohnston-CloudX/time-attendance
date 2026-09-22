"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, KeyRound } from "lucide-react";
import { createApiKey, revokeApiKey, regenerateApiKey } from "@/actions/api-key.actions";
import { format } from "date-fns";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  TableFooter,
  statusTone,
} from "@/components/ui";

/**
 * The API key table from the portal design, plus the two things the design's
 * static mock does not have to deal with: the one-time reveal after a key is
 * generated, and the fact that a revoked key is still worth showing.
 *
 * <p>Revoked keys stay in the list on purpose. A key that vanished on revoke
 * would leave no answer to "what was that key that stopped working on Tuesday",
 * which is the question somebody asks when an integration breaks.
 */

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
};

interface Props {
  apiKeys: ApiKey[];
  /** Driven by the "New Key" page action, which lives in IntegrationsClient. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button
      hierarchy="tertiary"
      size="sm"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy key"}
      leadingIcon={
        copied ? (
          <Check className="h-4 w-4" style={{ color: "var(--icon-success)" }} />
        ) : (
          <Copy className="h-4 w-4" style={{ color: "var(--icon-secondary)" }} />
        )
      }
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function ApiKeysManager({ apiKeys: initial, createOpen, onCreateOpenChange }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
      onCreateOpenChange(false);
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

  const activeCount = initial.filter((k) => k.isActive).length;

  return (
    <>
      {error && <Banner tone="error" title="That did not go through" body={error} />}

      {/* Shown once, straight after the server generated it. */}
      {revealedKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="ta-modal w-full max-w-lg rounded-2xl p-6">
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
                style={{ background: "var(--surface-success)" }}
              >
                <KeyRound className="h-5 w-5" style={{ color: "var(--icon-success)" }} />
              </span>
              <div className="min-w-0">
                <h3 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
                  API key created
                </h3>
                <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                  {revealedName}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <Banner
                tone="warning"
                body="Copy this key now. Only its hash is stored, so closing this dialog is the last time anyone can read it."
              />
            </div>

            <div
              className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2"
              style={{ border: "1px solid var(--stroke-secondary)", background: "var(--surface-secondary)" }}
            >
              <code
                className="min-w-0 flex-1 break-all"
                // `font` is a shorthand and resets the family, so it has to be
                // set before fontFamily — the other way round this key renders
                // proportional, which is how an l gets copied out as a 1.
                style={{ font: "var(--type-body2)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}
              >
                {revealedKey}
              </code>
              <CopyButton value={revealedKey} />
            </div>

            <div className="mt-5 flex justify-end">
              <Button hierarchy="primary" onClick={() => setRevealedKey(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <Card title="New Key" subtitle="The key is generated on the server and shown to you once.">
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Input
                label="Key name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Timeclock — 5903"
                hint="Name it after the thing that will hold it, not the person creating it."
                required
                autoFocus
              />
            </div>
            <Button type="submit" hierarchy="primary" disabled={isPending}>
              {isPending ? "Generating…" : "Generate"}
            </Button>
            <Button
              type="button"
              hierarchy="secondary"
              onClick={() => { onCreateOpenChange(false); setNewName(""); }}
            >
              Cancel
            </Button>
          </form>
        </Card>
      )}

      <Card
        title="API Keys"
        subtitle={
          initial.length === 0
            ? "None yet"
            : `${activeCount} active of ${initial.length}`
        }
        padding={0}
      >
        {initial.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-7 w-7" />}
            title="No API keys yet"
            body="A timeclock or an export needs a key before it can reach this tenant. Use New Key above."
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Key</TH>
                  <TH>Prefix</TH>
                  <TH>Created</TH>
                  <TH>Last used</TH>
                  <TH>Status</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {initial.map((key) => (
                  <TR key={key.id}>
                    <TD
                      style={{
                        fontWeight: "var(--weight-medium)",
                        color: key.isActive ? "var(--text-primary)" : "var(--text-tertiary)",
                      }}
                    >
                      {key.name}
                    </TD>
                    <TD style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                      {key.keyPrefix}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                      {format(new Date(key.createdAt), "d MMM yyyy")}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                      {key.lastUsedAt ? format(new Date(key.lastUsedAt), "d MMM yyyy") : "Never"}
                    </TD>
                    <TD>
                      {/* statusTone has no REVOKED case and would answer amber.
                          A revoked key is a hard 401 for whatever is holding it,
                          so it borrows CANCELLED's red rather than growing a
                          colour map of its own here. */}
                      <Badge tone={statusTone(key.isActive ? "ACTIVE" : "CANCELLED")} size="sm">
                        {key.isActive ? "Active" : "Revoked"}
                      </Badge>
                    </TD>
                    <TD align="right">
                      {key.isActive && (
                        <span className="inline-flex items-center gap-2">
                          <Button
                            hierarchy="secondary"
                            size="sm"
                            onClick={() => handleRegenerate(key.id, key.name)}
                            disabled={isPending}
                          >
                            Regenerate
                          </Button>
                          <Button
                            hierarchy="secondary"
                            size="sm"
                            tone="error"
                            onClick={() => handleRevoke(key.id, key.name)}
                            disabled={isPending}
                          >
                            Revoke
                          </Button>
                        </span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter
              shown={initial.length}
              total={initial.length}
              label={initial.length === 1 ? "key" : "keys"}
            />
          </>
        )}
      </Card>
    </>
  );
}
