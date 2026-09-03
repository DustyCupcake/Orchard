import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { member } from "./member";

export const authProviderEnum = pgEnum("auth_provider", ["magic_link", "oidc"]);

// Links a login-provider identity to a Member. See docs/spec.md's
// "Authentication" section — provider_subject is the durable OIDC `sub`
// claim (null for magic_link, where the email itself is the identity).
export const memberIdentity = pgTable(
  "member_identity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    provider: authProviderEnum("provider").notNull(),
    providerSubject: text("provider_subject"),
    loginEmail: text("login_email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("member_identity_provider_login_email_idx").on(t.provider, t.loginEmail),
    // "Identity is keyed on the OIDC sub claim, never on email" (see
    // docs/spec.md's Authentication, docs/development-plan.md's Phase
    // 57) — a real second lookup key alongside the one above, not a
    // replacement for it (magic_link identities still key on email;
    // every magic_link row's provider_subject is null, and Postgres
    // treats NULLs as distinct in a unique index, so this adds no
    // constraint among existing magic_link rows at all).
    uniqueIndex("member_identity_provider_subject_idx").on(t.provider, t.providerSubject),
  ],
);

// One-time, short-lived token emailed to a member for the magic-link
// flow. tokenHash is HMAC(SESSION_SECRET, raw token) — the raw token
// only ever exists in the emailed URL, never at rest.
export const magicLinkToken = pgTable("magic_link_token", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A logged-in session. Same tokenHash convention as magic_link_token —
// the raw value lives only in the session cookie.
export const session = pgTable("session", {
  tokenHash: text("token_hash").primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // View-as (see docs/spec.md's "View-as (support)", Phase 54) — an
  // overlay on this same session row, never a real session swap: the
  // real memberId above never changes, this just names who a Support-
  // task holder is currently rendering pages as. Both null when not
  // viewing as anyone. Cleared the moment the real member no longer
  // holds a Support task (re-checked live on every read, see
  // src/lib/view-as.ts's getActiveViewAs) — "access follows the task,
  // lose it, lose the access," same as everywhere else in this
  // codebase, deliberately used here instead of a separate expiry TTL.
  viewingAsMemberId: uuid("viewing_as_member_id").references(() => member.id),
  viewingAsStartedAt: timestamp("viewing_as_started_at", { withTimezone: true }),
});
