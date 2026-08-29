import { submitInquiryAction } from "./actions";

export const dynamic = "force-dynamic";

// Public, no login required — "a simple 'message us' box, no
// application structure, just a question or an expression of
// interest" (docs/spec.md's Recruitment). Not the evaluated
// application form itself — that's docs/development-plan.md's
// Phase 33.
export default async function InquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const { error, submitted } = await searchParams;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>Get in touch</h1>
      <p style={{ color: "#666" }}>
        Not ready to apply, or just have a question? Send us a message and someone will get back
        to you.
      </p>

      {submitted ? (
        <p style={{ color: "#2a7a2a" }}>Thanks — someone will be in touch.</p>
      ) : (
        <>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          <form
            action={submitInquiryAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 400 }}
          >
            <label>
              Your message
              <br />
              <textarea name="message" required rows={4} style={{ padding: "0.4rem", width: "100%" }} />
            </label>
            <label>
              How can we reach you?
              <br />
              <input
                type="text"
                name="contactInfo"
                required
                placeholder="email or phone"
                style={{ padding: "0.4rem", width: "100%" }}
              />
            </label>
            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              Send
            </button>
          </form>
        </>
      )}
    </main>
  );
}
