import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-1">
        <h1 className="text-xl font-semibold">Karachi Transit</h1>
        <p className="text-sm opacity-70">
          Sign in to continue. Demo / simulated hackathon data.
        </p>
      </div>

      <LoginForm />
    </main>
  );
}
