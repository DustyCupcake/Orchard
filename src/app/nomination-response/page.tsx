import { Banner, type Tone } from "@/components/ui/kit";

const STATUS_MESSAGE: Record<string, string> = {
  accepted: "Confirmed — you're all set, nothing else to do.",
  declined: "Got it — released back to Unclaimed, no explanation needed.",
  not_now: "Got it — released back to Unclaimed for now.",
  invalid: "That link isn't valid — it may have already been used, or expired.",
};

const STATUS_TONE: Record<string, Exclude<Tone, "neutral" | "accent" | "accent2">> = {
  accepted: "success",
  declined: "success",
  not_now: "success",
  invalid: "danger",
};

// Public, no login — where a one-click nomination-response email link
// lands. Same shell-free, unauthenticated posture as /login, /apply,
// /invite/[token] — see docs/development-plan.md's Phase 43 note on
// which routes stay outside the (app) group.
export default async function NominationResponsePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const key = status && STATUS_MESSAGE[status] ? status : "invalid";

  return (
    <main className="mx-auto max-w-[480px] px-6 py-16">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Orchard</h1>
      <div className="mt-4">
        <Banner tone={STATUS_TONE[key]}>{STATUS_MESSAGE[key]}</Banner>
      </div>
    </main>
  );
}
