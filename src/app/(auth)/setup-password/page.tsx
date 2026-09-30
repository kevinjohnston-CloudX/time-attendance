"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/components/layout/navigation-progress";
import { setupPasswordFromToken } from "@/actions/password.actions";
import { Banner, Button, Input } from "@/components/ui";
import { AuthScreen } from "../auth-screen";

/**
 * First sign-in: pick a password, using the link an administrator sent.
 *
 * <p>The three states this screen can be in — no usable link, the form, and
 * "done, going to sign in" — are all Banners rather than coloured paragraphs,
 * because each one is a state of the page and that is what a Banner is for.
 * The one that matters is the first: a dead link needs to say what to do next,
 * or the person waits for a second email nobody is sending.
 */
function SetupPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <Banner
        tone="error"
        title="This link is not valid any more"
        body="Setup links work once and expire after 24 hours. Ask the person who invited you to send a new one."
      />
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const result = await setupPasswordFromToken(token, password);
    setLoading(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push("/login"), 2000);
  }

  if (success) {
    return <Banner tone="success" body="Password set. Taking you to sign in…" />;
  }

  return (
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
        {loading ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}

export default function SetupPasswordPage() {
  return (
    <AuthScreen
      title="Set your password"
      sub="Choose a password to finish setting up your account."
      note="Your badge works the same as before. This password is only for signing in to CloudTime."
    >
      <Suspense
        fallback={
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
            Loading…
          </p>
        }
      >
        <SetupPasswordForm />
      </Suspense>
    </AuthScreen>
  );
}
