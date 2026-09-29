-- Give every existing member a primary contact method, seeded from the
-- address they already sign in with.
--
-- 0084 added `contact_method.is_primary` and `verified_at` and seeded the
-- row on all five *provisioning* paths, which is why nobody who joined
-- before it has one. This backfills the ones already in the database, so
-- that a member's delivery address is something they can see and move
-- rather than an invisible column on a row they never see.
--
-- Two things are deliberately not done here.
--
-- **A member who already has a primary is left alone**, and so is one who
-- has already added their login address as an ordinary contact method —
-- in the second case there is nothing to gain. `resolvePrimaryEmail` falls
-- back to the login address anyway, so the delivery behaviour is identical
-- whether or not a row exists; what the row buys is a control. Promoting
-- an existing row instead would be the tidier outcome, but it would also
-- mean this migration choosing a `visibility` the member picked, which is
-- not this migration's call.
--
-- **`verified_at` is set only for magic-link identities.** Those are
-- provably verified: a magic link is only ever sent to an address, and
-- reaching the identity at all means somebody clicked the one that arrived
-- there. An OIDC identity is *not* marked verified, because the
-- `email_verified` claim was never stored — `member_identity` keeps
-- `login_email` and nothing about how the IdP vouched for it. So for those
-- the honest answer to "was this address verified?" is "unknown", and an
-- unknown must not be written down as a yes. It costs the member nothing:
-- the fallback delivers to the same address, and their profile offers the
-- one-click confirmation that settles it.
--
-- `DISTINCT ON (member_id)` because a member can hold more than one
-- identity — a magic-link and an OIDC one on the same account — and two
-- primaries would break the invariant the whole feature rests on. The
-- ordering puts the provably-verified magic-link row first.
--
-- Hand-written: drizzle-kit diffs schemas, not data, and cannot emit a
-- backfill at all.
INSERT INTO "contact_method" ("member_id", "type", "value", "visibility", "is_primary", "verified_at")
SELECT DISTINCT ON (mi."member_id")
  mi."member_id",
  'email',
  mi."login_email",
  'emergency_only',
  true,
  CASE WHEN mi."provider" = 'magic_link' THEN now() ELSE NULL END
FROM "member_identity" mi
WHERE NOT EXISTS (
    SELECT 1 FROM "contact_method" cm
    WHERE cm."member_id" = mi."member_id" AND cm."is_primary" = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM "contact_method" cm
    WHERE cm."member_id" = mi."member_id" AND lower(cm."value") = lower(mi."login_email")
  )
ORDER BY mi."member_id", (mi."provider" = 'magic_link') DESC, mi."created_at";
