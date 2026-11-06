"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { KeyRound } from "lucide-react";
import { changeOwnPassword } from "@/actions/password.actions";
import { useRouter } from "@/components/layout/navigation-progress";
import { Banner, Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";

/**
 * The form behind Change Password. On success every sign in has already
 * ended on the server, so this one signs out at once and opens sign in,
 * rather than failing on the next click with nothing said.
 */
export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setSaving(true);
    const result = await changeOwnPassword(current, password, confirm).catch(() => null);
    if (!result?.success) {
      setSaving(false);
      setError(result?.message ?? "The password could not be changed. Try again.");
      return;
    }
    await signOut({ redirect: false });
    router.push("/login?changed=1");
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned title="Change Password" subtitle="The password you sign in to CloudTime with" />

      {!hasPassword ? (
        <Card>
          <EmptyState
            icon={<KeyRound className="h-8 w-8" />}
            title="No CloudTime password"
            body="You sign in with Google, so your password is changed in your Google account."
          />
        </Card>
      ) : (
        <div className="w-full max-w-[480px]">
          <Card>
            <form method="post" action="" onSubmit={handleSubmit} className="flex flex-col gap-3">
              <Input
                id="current-password"
                type="password"
                label="Current password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
              <Input
                id="new-password"
                type="password"
                label="New password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                hint="8+ characters, with an uppercase letter, a number and a symbol."
              />
              <Input
                id="confirm-password"
                type="password"
                label="Confirm new password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />

              {error && <Banner tone="error" body={error} />}

              <Button pending={saving} type="submit" disabled={saving} fullWidth>
                {saving ? "Saving…" : "Change password"}
              </Button>
              <p className="m-0 text-center" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                You will be signed out on every device, then sign in again with the new password.
              </p>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
