"use client";

import { useState } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { signOut } from "next-auth/react";
import { changePassword } from "@/actions/password.actions";
import { Banner, Button, Input } from "@/components/ui";
import { AuthScreen } from "../auth-screen";

/**
 * The forced change after an administrator has issued a temporary password.
 *
 * <p>The note under the button says the session ends, because it does: the
 * new password is written and then this signs you out, so the next session is
 * minted without `mustChangePassword`. Somebody who is not told that reads the
 * jump back to sign-in as the change having failed and does it again.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const result = await changePassword(password, confirm);
    setLoading(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    // Sign out so the new session (without mustChangePassword) starts fresh
    await signOut({ redirect: false });
    router.push("/login");
  }

  return (
    <AuthScreen
      title="Change your password"
      sub="You must set a new password before continuing."
      note="You will be signed out and asked to sign in again with the new password."
    >
      <form method="post" action="" onSubmit={handleSubmit} className="flex flex-col gap-2.5">
        <Input
          id="password"
          type="password"
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          placeholder="At least 8 characters"
          // The rules belong on the field they apply to, not in a paragraph
          // above the form that people scroll past and then fail against.
          hint="8+ characters, with an uppercase letter, a number and a symbol."
        />

        <Input
          id="confirm"
          type="password"
          label="Confirm password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          placeholder="Re-enter password"
        />

        {error && <Banner tone="error" body={error} />}

        <Button type="submit" disabled={loading} fullWidth>
          {loading ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </AuthScreen>
  );
}
