import { LockKeyhole, MessageSquareText, Server, Users } from "lucide-react";
import { backendUrl } from "@/lib/api";

export default function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">
          <MessageSquareText size={34} />
        </div>
        <p className="eyebrow">Campus Chat</p>
        <h1>Secure realtime collaboration for your campus.</h1>
        <p className="auth-copy">
          Sign in with your Google account to access organized rooms, live messaging, and a focused
          workspace for college discussions.
        </p>
        <ErrorMessage searchParams={searchParams} />
        <a className="google-button" href={`${backendUrl}/auth/google`}>
          Continue with Google
        </a>
        <div className="feature-grid">
          <span>
            <LockKeyhole size={18} /> Google sign-in
          </span>
          <span>
            <Users size={18} /> Team channels
          </span>
          <span>
            <Server size={18} /> Server-side data
          </span>
        </div>
      </section>
    </main>
  );
}

async function ErrorMessage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  if (!params.error) return null;
  return <p className="error-banner">Google sign in failed. Please try again.</p>;
}
