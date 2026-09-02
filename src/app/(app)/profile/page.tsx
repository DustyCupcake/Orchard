import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { tier } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { listOnceEverAnswers, listOutstandingQuestions } from "@/lib/profile-questions";
import { getCommunity, getCycleTypeCountProgress } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { SENSITIVE_FIELD_LABELS, SensitiveFieldKey } from "@/lib/sensitive-data";
import { CONTACT_METHOD_VISIBILITIES, listOwnContactMethods } from "@/lib/contact-methods";
import { getGatingPurposesForCommunity, hasActiveConsent, listMyConsentStatus } from "@/lib/consent";
import {
  createContactMethodAction,
  deleteContactMethodAction,
  grantConsentAction,
  submitProfileAnswerAction,
  updateContactMethodAction,
  updateProfile,
  updateSensitiveDataAction,
  withdrawConsentAction,
} from "./actions";

const CONTACT_VISIBILITY_LABELS: Record<(typeof CONTACT_METHOD_VISIBILITIES)[number], string> = {
  everyone: "Everyone in the community",
  task_or_group_mates: "People I share a task or group with",
  emergency_only: "Emergency only",
};

export const dynamic = "force-dynamic";

// Phase 46: an inline consent prompt shown only when a field has a
// configured gating purpose (src/lib/consent.ts's
// getGatingPurposesForCommunity) and this member hasn't granted it yet
// — "at the point a gated field is first populated, not a separate
// settings screen visited in advance." Renders nothing once consent is
// already active (see the general "Your consent" section further down
// for withdrawing it) or when the field isn't gated at all.
function ConsentCheckbox({
  fieldKey,
  formKey,
  gatingPurposes,
  active,
}: {
  fieldKey: SensitiveFieldKey;
  formKey: string;
  gatingPurposes: Map<SensitiveFieldKey, { id: string; label: string; noticeText: string }>;
  active: boolean;
}) {
  const purpose = gatingPurposes.get(fieldKey);
  if (!purpose || active) return null;
  return (
    <div
      style={{
        background: "#fafafa",
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "0.5rem",
        fontSize: "0.8rem",
        marginTop: "0.25rem",
      }}
    >
      <p style={{ margin: "0 0 0.4rem" }}>{purpose.noticeText}</p>
      <label>
        <input type="checkbox" name={`consent_${formKey}`} /> I consent to &ldquo;{purpose.label}&rdquo;
      </label>
    </div>
  );
}

function QuestionForm({
  questionId,
  responseType,
  options,
  feedsCapacitySignal,
  defaultValue,
  defaultCapacityVisibility,
}: {
  questionId: string;
  responseType: "free_text" | "single_choice" | "multi_choice" | "date";
  options: string[];
  feedsCapacitySignal: boolean;
  defaultValue?: unknown;
  defaultCapacityVisibility?: "flag_only" | "open";
}) {
  return (
    <form
      action={submitProfileAnswerAction}
      style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
    >
      <input type="hidden" name="questionId" value={questionId} />
      {responseType === "free_text" && (
        <input
          type="text"
          name="value"
          defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          style={{ padding: "0.4rem" }}
        />
      )}
      {responseType === "date" && (
        <input
          type="date"
          name="value"
          defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          style={{ padding: "0.4rem" }}
        />
      )}
      {responseType === "single_choice" && (
        <div>
          {options.map((o) => (
            <label key={o} style={{ display: "block" }}>
              <input type="radio" name="value" value={o} defaultChecked={defaultValue === o} /> {o}
            </label>
          ))}
        </div>
      )}
      {responseType === "multi_choice" && (
        <div>
          {options.map((o) => (
            <label key={o} style={{ display: "block" }}>
              <input
                type="checkbox"
                name="value_multi"
                value={o}
                defaultChecked={Array.isArray(defaultValue) && defaultValue.includes(o)}
              />{" "}
              {o}
            </label>
          ))}
        </div>
      )}
      {feedsCapacitySignal && (
        <label style={{ fontSize: "0.8rem" }}>
          Visible to coordinators as
          <select
            name="capacityVisibility"
            defaultValue={defaultCapacityVisibility ?? "flag_only"}
            style={{ marginLeft: "0.4rem", padding: "0.2rem" }}
          >
            <option value="flag_only">a coarse flag only</option>
            <option value="open">the exact number</option>
          </select>
        </label>
      )}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" name="status" value="answered" style={{ padding: "0.3rem 0.8rem" }}>
          Save
        </button>
        <button type="submit" name="status" value="deferred" style={{ padding: "0.3rem 0.8rem" }}>
          I don&rsquo;t know yet
        </button>
      </div>
    </form>
  );
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [communityTiers, outstanding, onceEverAnswers, communityRow, cycleTypeProgress, ownContactMethods, gatingPurposes, myConsentStatus] =
    await Promise.all([
      db.select().from(tier).where(eq(tier.communityId, currentMember.communityId)),
      listOutstandingQuestions(currentMember),
      listOnceEverAnswers(currentMember),
      getCommunity(currentMember),
      getCycleTypeCountProgress(currentMember),
      listOwnContactMethods(currentMember),
      getGatingPurposesForCommunity(currentMember.communityId),
      listMyConsentStatus(currentMember),
    ]);
  const sensitiveDataOn = isModuleEnabled(communityRow, "sensitive_data");
  // Only a manual-criterion tier is ever hand-toggled here — a computed
  // one (cycle_type_count, Phase 40) is owned by syncComputedTiers and
  // shown read-only below instead. See actions.ts's updateProfile for
  // why the submitted checkbox set can't just overwrite tierIds wholesale.
  const manualTiers = communityTiers.filter((t) => t.criterionType === "manual");

  // Phase 46: which of the 4 sensitive fields currently need a consent
  // prompt inline (a gating purpose exists, and this member hasn't
  // granted it yet) — computed once for the Sensitive data section
  // below rather than re-querying per field.
  const fieldConsentActive = new Map<SensitiveFieldKey, boolean>();
  for (const [fieldKey, purpose] of gatingPurposes) {
    fieldConsentActive.set(fieldKey, await hasActiveConsent(currentMember.id, purpose.id));
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>Your profile</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <form action={updateProfile} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          Name
          <br />
          <input
            type="text"
            name="name"
            defaultValue={currentMember.name}
            required
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </label>

        <label>
          Tags (comma-separated)
          <br />
          <input
            type="text"
            name="tags"
            defaultValue={currentMember.tags.join(", ")}
            placeholder="carpentry, spanish, night-owl"
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </label>

        {manualTiers.length > 0 && (
          <fieldset>
            <legend>Tiers (manual assignment)</legend>
            {manualTiers.map((t) => (
              <label key={t.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  name="tierIds"
                  value={t.id}
                  defaultChecked={currentMember.tierIds.includes(t.id)}
                />{" "}
                {t.name}
              </label>
            ))}
          </fieldset>
        )}

        <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
          Save
        </button>
      </form>

      {cycleTypeProgress.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Cycle-type progress</h2>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            Computed live off your declared Participation — see /participation.
          </p>
          {cycleTypeProgress.map((p) => (
            <p key={p.tierId} style={{ color: p.held ? "#2a7a2a" : "#666" }}>
              {p.tierName} ({p.cycleTypeName}): {p.count}/{p.minCount} {p.held ? "— earned" : ""}
            </p>
          ))}
        </section>
      )}

      {outstanding.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Questions for you</h2>
          {outstanding.map(({ question, existingAnswer }) => (
            <div
              key={question.id}
              style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
            >
              <strong>
                {question.label}
                {question.required ? " *" : ""}
              </strong>
              {existingAnswer?.status === "deferred" && (
                <p style={{ color: "#666", fontSize: "0.8rem", margin: "0.2rem 0" }}>
                  You said you didn&rsquo;t know yet.
                </p>
              )}
              <QuestionForm
                questionId={question.id}
                responseType={question.responseType}
                options={question.options}
                feedsCapacitySignal={question.feedsCapacitySignal}
              />
            </div>
          ))}
        </section>
      )}

      {onceEverAnswers.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Your answers</h2>
          {onceEverAnswers.map(({ question, answer }) => (
            <div
              key={question.id}
              style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
            >
              <strong>{question.label}</strong>
              <QuestionForm
                questionId={question.id}
                responseType={question.responseType}
                options={question.options}
                feedsCapacitySignal={question.feedsCapacitySignal}
                defaultValue={answer.value}
                defaultCapacityVisibility={answer.capacityVisibility}
              />
            </div>
          ))}
        </section>
      )}

      {sensitiveDataOn && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Sensitive data</h2>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            Always yours to see and edit. Only visible to others via a task or tier your Community
            has explicitly set to unlock a given field — see <code>/sensitive-data</code>.
          </p>
          <form
            action={updateSensitiveDataAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            <label>
              {SENSITIVE_FIELD_LABELS.health_conditions}
              <br />
              <textarea
                name="healthConditions"
                rows={2}
                defaultValue={currentMember.healthConditions ?? ""}
                style={{ padding: "0.5rem", width: "100%" }}
              />
            </label>
            <ConsentCheckbox
              fieldKey="health_conditions"
              formKey="healthConditions"
              gatingPurposes={gatingPurposes}
              active={fieldConsentActive.get("health_conditions") ?? false}
            />
            <label>
              {SENSITIVE_FIELD_LABELS.allergies}
              <br />
              <textarea
                name="allergies"
                rows={2}
                defaultValue={currentMember.allergies ?? ""}
                style={{ padding: "0.5rem", width: "100%" }}
              />
            </label>
            <ConsentCheckbox
              fieldKey="allergies"
              formKey="allergies"
              gatingPurposes={gatingPurposes}
              active={fieldConsentActive.get("allergies") ?? false}
            />
            <label>
              {SENSITIVE_FIELD_LABELS.emergency_contact}
              <br />
              <input
                type="text"
                name="emergencyContact"
                defaultValue={currentMember.emergencyContact ?? ""}
                style={{ padding: "0.5rem", width: "100%" }}
              />
            </label>
            <ConsentCheckbox
              fieldKey="emergency_contact"
              formKey="emergencyContact"
              gatingPurposes={gatingPurposes}
              active={fieldConsentActive.get("emergency_contact") ?? false}
            />
            <label>
              {SENSITIVE_FIELD_LABELS.orientation}
              <br />
              <input
                type="text"
                name="orientation"
                defaultValue={currentMember.orientation ?? ""}
                style={{ padding: "0.5rem", width: "100%" }}
              />
            </label>
            <ConsentCheckbox
              fieldKey="orientation"
              formKey="orientation"
              gatingPurposes={gatingPurposes}
              active={fieldConsentActive.get("orientation") ?? false}
            />
            <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
              Save
            </button>
          </form>
        </section>
      )}

      <section style={{ marginTop: "2rem" }}>
        <h2>Contact methods</h2>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          You control who sees each one. &ldquo;Emergency only&rdquo; means any member can activate
          Emergency access to reveal it when needed — both of you get notified, and every activation
          is logged. See <code>/members</code> for other members&rsquo; visible methods.
        </p>
        {ownContactMethods.length === 0 && <p style={{ color: "#666" }}>No contact methods yet.</p>}
        {ownContactMethods.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "0.5rem",
              marginBottom: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <form action={updateContactMethodAction} style={{ display: "flex", gap: "0.5rem", flex: 1, flexWrap: "wrap" }}>
              <input type="hidden" name="id" value={m.id} />
              <input type="text" name="type" defaultValue={m.type} style={{ padding: "0.3rem", width: 100 }} />
              <input
                type="text"
                name="value"
                defaultValue={m.value}
                style={{ padding: "0.3rem", flex: 1, minWidth: 160 }}
              />
              <select name="visibility" defaultValue={m.visibility} style={{ padding: "0.3rem" }}>
                {CONTACT_METHOD_VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {CONTACT_VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </select>
              <button type="submit">Save</button>
            </form>
            <form action={deleteContactMethodAction}>
              <input type="hidden" name="id" value={m.id} />
              <button type="submit">Delete</button>
            </form>
          </div>
        ))}

        <form
          action={createContactMethodAction}
          style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.75rem", flexWrap: "wrap" }}
        >
          <input type="text" name="type" placeholder="email, phone, telegram…" required style={{ padding: "0.3rem", width: 140 }} />
          <input type="text" name="value" placeholder="value" required style={{ padding: "0.3rem", flex: 1, minWidth: 160 }} />
          <select name="visibility" defaultValue="everyone" style={{ padding: "0.3rem" }}>
            {CONTACT_METHOD_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {CONTACT_VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
          <button type="submit">Add</button>
        </form>
      </section>

      {myConsentStatus.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Your consent</h2>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            Every purpose your Community has defined, and whether you currently have it active.
            Withdrawing takes effect immediately — anything it gates stops showing right away.
          </p>
          {myConsentStatus.map(({ purpose, active, grantedAt }) => (
            <div
              key={purpose.id}
              style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
            >
              <strong>{purpose.label}</strong>
              {purpose.gatesSensitiveField && (
                <span style={{ color: "#666" }}> — gates {SENSITIVE_FIELD_LABELS[purpose.gatesSensitiveField]}</span>
              )}
              <p style={{ color: "#666", fontSize: "0.8rem", margin: "0.3rem 0" }}>{purpose.noticeText}</p>
              {active ? (
                <>
                  <span style={{ color: "#2a7a2a", fontSize: "0.85rem" }}>
                    Active{grantedAt ? ` since ${new Date(grantedAt).toLocaleDateString()}` : ""}
                  </span>
                  <form action={withdrawConsentAction} style={{ display: "inline", marginLeft: "0.5rem" }}>
                    <input type="hidden" name="purposeId" value={purpose.id} />
                    <button type="submit">Withdraw</button>
                  </form>
                </>
              ) : (
                <form action={grantConsentAction}>
                  <input type="hidden" name="purposeId" value={purpose.id} />
                  <button type="submit">Grant consent</button>
                </form>
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
