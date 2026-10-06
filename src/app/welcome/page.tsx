import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { listOwnContactMethods, isEmailContactMethod, CONTACT_METHOD_VISIBILITIES } from "@/lib/contact-methods";
import { listOwnMemberLanguages, MEMBER_LANGUAGE_LEVELS } from "@/lib/member-languages";
import { getCommunityRow } from "@/lib/recruitment";
import SelectField from "@/components/ui/SelectField";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL } from "@/components/ui/kit";
import { completeProfileSetupAction, skipProfileSetupAction } from "./actions";

export const dynamic = "force-dynamic";

const VISIBILITY_LABELS: Record<string, string> = {
  everyone: "Everyone in the community can see this",
  task_or_group_mates: "Only people I share a task or group with",
  emergency_only: "Emergency only",
};

const LANGUAGE_LEVEL_LABELS: Record<string, string> = {
  basic: "Basic",
  conversational: "Conversational",
  fluent: "Fluent",
  native: "Native",
};

// The name the profile already holds, offered as an editable default
// rather than a blank field. Four of the five ways into this app derive a
// Member's name from something that isn't a name — an email local part, an
// IdP claim, a name an inviter guessed — and all of them land here with
// that value already in `member.name`. Showing it pre-filled (and required)
// means the common case is one keystroke to fix "t.doe" into "Toby" and
// the uncommon case is deleting a suggestion. The alternative, a blank
// field, is worse: it makes the member remember and retype a name we
// already had, and makes the required-validation error a punishment for
// doing exactly the thing we want.
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const current = await getCurrentMember();
  if (!current) {
    redirect("/login");
  }

  // The "you've already been here" bounce. Keeps a bookmarked or shared
  // /welcome link from parking somebody on a form for a profile that's
  // already set up — and it's the reason the screen can be a genuine
  // one-time redirect rather than a permanent destination.
  if (current.profileCompletedAt) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const community = await getCommunityRow(current.communityId);

  const [contactMethods, languages] = await Promise.all([
    listOwnContactMethods(current),
    listOwnMemberLanguages(current),
  ]);

  const emailMethods = contactMethods.filter(isEmailContactMethod);
  const otherMethods = contactMethods.filter((m) => !isEmailContactMethod(m));

  // Languages are only *asked for* if the member has none. An applicant
  // whose application was tagged to carry them has already given this
  // answer, and re-asking would be the exact "typed it twice" failure the
  // application's profile-question mapping exists to avoid.
  const askForLanguages = languages.length === 0;

  return (
    <main className="mx-auto max-w-[520px] px-6 py-12 md:py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Welcome to {community.name}</h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
        A few things the rest of {community.name} assumes are true about you. Nothing here is required
        except a name, and you can change all of it later in your profile.
      </p>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <form action={completeProfileSetupAction} className="mt-6 flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL}>What should we call you?</legend>
          <input
            type="text"
            name="name"
            defaultValue={current.name}
            required
            maxLength={120}
            autoComplete="nickname"
            className={INPUT}
          />
          <p className="text-[length:var(--text-micro)] text-[var(--text-muted)]">
            The name everyone else sees. A first name, a nickname, whatever you actually go by.
          </p>
        </fieldset>

        {emailMethods.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className={LABEL}>Your email</legend>
            {emailMethods.map((m) => (
              <div key={m.id} className="flex flex-col gap-1">
                <input type="hidden" name={`type_${m.id}`} value={m.type} />
                <input type="hidden" name={`value_${m.id}`} value={m.value} />
                <p className="text-[length:var(--text-meta)] text-[var(--text)]">{m.value}</p>
                <SelectField
                  name={`visibility_${m.id}`}
                  defaultValue={m.visibility}
                  className={INPUT}
                  aria-label={`Who can see ${m.value}`}
                >
                  {CONTACT_METHOD_VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {VISIBILITY_LABELS[v]}
                    </option>
                  ))}
                </SelectField>
              </div>
            ))}
            <p className="text-[length:var(--text-micro)] text-[var(--text-muted)]">
              This is where {community.name} sends your mail, so it stays on your account whatever you
              choose here. The visibility controls who can <em>read</em> it. Add another way to reach you
              below.
            </p>
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL}>Another way to reach you (optional)</legend>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              name="newType"
              placeholder="phone, telegram…"
              className={`${INPUT} w-40`}
              aria-label="Type of contact method"
            />
            <input
              type="text"
              name="newValue"
              placeholder="value"
              className={`${INPUT} min-w-[160px] flex-1`}
              aria-label="Contact method value"
            />
          </div>
          <SelectField
            name="newVisibility"
            defaultValue="everyone"
            className={INPUT}
            aria-label="Who can see this contact method"
          >
            {CONTACT_METHOD_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABELS[v]}
              </option>
            ))}
          </SelectField>
        </fieldset>

        {otherMethods.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className={LABEL}>Contact methods you already had</legend>
            {otherMethods.map((m) => (
              <div key={m.id} className="flex flex-col gap-1">
                <input type="hidden" name={`type_${m.id}`} value={m.type} />
                <input type="hidden" name={`value_${m.id}`} value={m.value} />
                <p className="text-[length:var(--text-meta)] text-[var(--text)]">
                  {m.type}: {m.value}
                </p>
                <SelectField
                  name={`visibility_${m.id}`}
                  defaultValue={m.visibility}
                  className={INPUT}
                  aria-label={`Who can see ${m.type} ${m.value}`}
                >
                  {CONTACT_METHOD_VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {VISIBILITY_LABELS[v]}
                    </option>
                  ))}
                </SelectField>
              </div>
            ))}
          </fieldset>
        )}

        {askForLanguages && (
          <fieldset className="flex flex-col gap-2">
            <legend className={LABEL}>What languages do you speak?</legend>
            <p className="text-[length:var(--text-micro)] text-[var(--text-muted)]">
              Used to offer you tasks that need an interpreter, and to check a task&rsquo;s language
              requirement is met. Leave blank if you&rsquo;d rather not say.
            </p>
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  name="language"
                  placeholder="language"
                  className={`${INPUT} min-w-[140px] flex-1`}
                  aria-label={`Language ${i + 1}`}
                />
                <SelectField name="languageLevel" defaultValue="conversational" className={INPUT} aria-label={`Level for language ${i + 1}`}>
                  {MEMBER_LANGUAGE_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LEVEL_LABELS[l]}
                    </option>
                  ))}
                </SelectField>
              </div>
            ))}
          </fieldset>
        )}

        <label className="flex items-start gap-2 text-[length:var(--text-meta)] text-[var(--text)]">
          <input type="checkbox" name="emailNotificationsEnabled" defaultChecked className="mt-0.5" />
          <span>
            Email me about things that need my attention — a task I&rsquo;m holding, someone waiting on
            an answer, a shift coming up.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={BUTTON_PRIMARY}>
            Save and continue
          </button>
        </div>
      </form>

      {/* Not a second form. A nudge that costs nothing, and the reason
          this screen is "asked once" rather than "mandatory": the skip
          button marks the same column the submit does, so a member who
          genuinely would rather not answer here is never shown this again
          and is never blocked. Everything above stays editable at
          /profile. */}
      <form action={skipProfileSetupAction} className="mt-4">
        <button type="submit" className={BUTTON_SECONDARY}>
          Skip for now — I&rsquo;ll do this later
        </button>
      </form>
    </main>
  );
}
