import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
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
    <main className="mx-auto max-w-[480px] px-6 py-16">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Get in touch</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Not ready to apply, or just have a question? Send us a message and someone will get back
        to you.
      </p>

      {submitted ? (
        <div className="mt-4">
          <Banner tone="success">Thanks — someone will be in touch.</Banner>
        </div>
      ) : (
        <>
          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          <form action={submitInquiryAction} className="mt-6 flex max-w-[400px] flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Your message</span>
              <textarea name="message" required rows={4} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>How can we reach you?</span>
              <input type="text" name="contactInfo" required placeholder="email or phone" className={INPUT} />
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Send
            </button>
          </form>
        </>
      )}
    </main>
  );
}
