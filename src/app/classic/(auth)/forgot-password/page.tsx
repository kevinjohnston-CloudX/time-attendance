export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-800 p-8 shadow-lg">
      <div className="mb-8 text-center">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Reset Password</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Contact your administrator to reset your password.
        </p>
      </div>
      <a
        href="/login"
        className="block text-center text-sm text-zinc-600 hover:underline dark:text-zinc-400"
      >
        Back to sign in
      </a>
    </div>
  );
}
