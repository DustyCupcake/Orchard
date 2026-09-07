"use client";

import { useState } from "react";
import { BUTTON_PRIMARY, INPUT } from "@/components/ui/kit";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");

    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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
      <p className="text-[13px] text-[var(--success)]">
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
      {status === "error" && <p className="text-[13px] text-[var(--danger)] sm:self-center">Something went wrong — try again.</p>}
    </form>
  );
}
