const STATUS_MESSAGE: Record<string, string> = {
  accepted: "Confirmed — you're all set, nothing else to do.",
  declined: "Got it — released back to Unclaimed, no explanation needed.",
  not_now: "Got it — released back to Unclaimed for now.",
  invalid: "That link isn't valid — it may have already been used, or expired.",
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
  const message = (status && STATUS_MESSAGE[status]) || STATUS_MESSAGE.invalid;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>Orchard</h1>
      <p>{message}</p>
    </main>
  );
}
