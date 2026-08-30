"use client";

import { useState } from "react";

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
    return <p>Check your email for a login link — it works once and expires in 15 minutes.</p>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ padding: "0.5rem", flex: 1 }}
      />
      <button type="submit" disabled={status === "submitting"} style={{ padding: "0.5rem 1rem" }}>
        {status === "submitting" ? "Sending…" : "Send login link"}
      </button>
      {status === "error" && (
        <p style={{ color: "crimson" }}>Something went wrong — try again.</p>
      )}
    </form>
  );
}
