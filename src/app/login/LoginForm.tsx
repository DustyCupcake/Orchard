"use client";

import { useState } from "react";
import { BUTTON_PRIMARY, INPUT } from "@/components/ui/kit";

export default function LoginForm({ next }: { next?: string | null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");

    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `next` is where the login should return the visitor — see
        // src/lib/login-destination.ts. The server re-validates it and
        // stores it in the login-destination cookie for /api/auth/verify.
        body: JSON.stringify({ email, next: next ?? null }),
        // The API route always responds fast now (mail sending failures are
        // caught server-side), but this keeps the button from hanging
        // forever if the request itself never completes for some other
        // reason.
        signal: AbortSignal.timeout(20_000),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <p className="text-[length:var(--text-body)] text-[var(--success)]">
        Check your email for a login link — it works once and expires in 15 minutes.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={`${INPUT} flex-1`}
      />
      <button type="submit" disabled={status === "submitting"} className={BUTTON_PRIMARY}>
        {status === "submitting" ? "Sending…" : "Send login link"}
      </button>
      {status === "error" && <p className="text-[length:var(--text-body)] text-[var(--danger)] sm:self-center">Something went wrong — try again.</p>}
    </form>
  );
}
