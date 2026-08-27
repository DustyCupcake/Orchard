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
  (t) => [uniqueIndex("member_identity_provider_login_email_idx").on(t.provider, t.loginEmail)],
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
});
