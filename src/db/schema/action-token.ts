import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Generic one-time, short-lived, click-to-act token — the shared
// infrastructure docs/development-plan.md's Phase 51 explicitly builds
// once for reuse rather than per-consumer: "meant to be reused as-is
// by Phase 52, not rebuilt per consumer." Mirrors magicLinkToken (see
// src/db/schema/auth.ts) exactly — tokenHash is HMAC(SESSION_SECRET,
// raw token), the raw token only ever exists in the emailed URL, never
// at rest — generalized with a `kind` (which consumer/action this
// token is for) and an opaque `payload` (kind-specific data resolved
// on consumption, e.g. `{nominationId, response}` for Phase 51's own
// first use) instead of a single hardcoded `email` column. Each token
// is issued already bound to one specific action (see
// src/lib/notifications/action-tokens.ts) — a one-click email link
// never carries a caller-suppliable "which action" parameter that
// could be tampered with, the same reasoning a magic link is bound to
// one specific email at issue time.
export const actionToken = pgTable("action_token", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
