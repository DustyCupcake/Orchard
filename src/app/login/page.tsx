import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCommunity } from "@/lib/community";
import { isOidcConfigured } from "@/lib/oidc";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/kit";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "That login link is missing its token.",
  invalid_or_expired: "That login link is invalid or has expired — request a new one.",
  no_account: "No account found for that email. If you have an invite link, use it — otherwise, get in touch below.",
  oidc_not_configured: "Single sign-on isn't configured for this community.",
  oidc_state_missing: "That sign-in attempt expired or was tampered with — try again.",
  oidc_error: "Something went wrong signing in with Zitadel — try again.",
  oidc_not_authorized:
    "You're signed in to Zitadel, but don't have the role needed for an Orchard account. Contact an admin if you think this is wrong.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; method?: string }>;
}) {
  const { error, method } = await searchParams;
  const community = await getOrCreateCommunity();
  const oidcOn = isOidcConfigured(community);
  // A separate, per-Community opt-in from merely having OIDC configured
  // and working — see src/db/schema/community.ts's own comment on
  // oidcPrimary. Off: unchanged from magic-link-only behavior, both
  // shown as equal options below.
  const ssoIsPrimary = oidcOn && community.oidcPrimary;

  // SSO is the primary path when the Community's opted into that — skip
  // this page entirely and land straight on Zitadel, no extra click. An
  // in-flight error or an explicit ?method=magic-link both need the real
  // page below instead: redirecting again after an error would just
  // mask it, and magic-link (now a fallback for someone who already has
  // a Zitadel-linked account — see findOrCreateMemberByEmail) needs
  // *some* reachable path even though it's deliberately not advertised
  // on the happy path.
  if (ssoIsPrimary && !error && method !== "magic-link") {
    redirect("/api/auth/oidc/login");
  }

  return (
    <main className="mx-auto max-w-[480px] px-6 py-16">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Log in to Orchard</h1>

      {error && ERROR_MESSAGES[error] && (
        <div className="mt-4">
          <Banner tone="danger">{ERROR_MESSAGES[error]}</Banner>
        </div>
      )}

      {oidcOn && (
        <div className="mt-6">
          <a href="/api/auth/oidc/login" className={ssoIsPrimary ? BUTTON_PRIMARY : BUTTON_SECONDARY}>
            Sign in with Zitadel
          </a>
        </div>
      )}

      <div className="mt-6">
        {ssoIsPrimary && (
          <p className="mb-2 text-[13px] text-[var(--text-muted)]">
            Magic-link only works if you already have a Zitadel-linked account here.
          </p>
        )}
        <LoginForm />
      </div>

      {error === "no_account" && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          <Link href="/inquiry" className="text-[var(--accent-1)] hover:underline">
            Send us a message
          </Link>{" "}
          and someone will get back to you.
        </p>
      )}
    </main>
  );
}
