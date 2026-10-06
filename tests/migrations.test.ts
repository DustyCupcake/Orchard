import { afterEach, describe, expect, it } from "vitest";
import { createScratchDatabase, type ScratchDatabase } from "./migration-helpers";

// Migrations that change rows that already exist, run against rows that
// already exist. See migration-helpers.ts for why the ordinary suite can't
// do this: it only ever migrates an empty database.
//
// Each test inserts data in the shape the schema had *before* the migration
// under test, in plain SQL, because the current schema no longer describes it.
// Only migrations that move, backfill or tighten data belong here — a new
// table or a nullable column has nothing to be wrong about on existing rows.

const uuid = () => crypto.randomUUID();

describe("migrating a database that already has data", () => {
  let db: ScratchDatabase | null = null;

  afterEach(async () => {
    await db?.drop();
    db = null;
  });

  // The regression that motivated all of this. 0083 added
  // objection.community_id as NOT NULL with no default and filled it in
  // afterwards; Postgres checks the constraint against existing rows when the
  // column is added, so with one objection in the table the ADD COLUMN itself
  // failed, the whole batch rolled back, and the container never started.
  it("0083 backfills objection.community_id from the form it was raised against", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0083_joining_admission_back_end");
    const sql = db.sql;

    const [communityA, communityB, memberA, memberB, formA, formB, responseA, responseB] = Array.from({ length: 8 }, uuid);
    await sql`insert into community (id, name) values (${communityA}, 'A'), (${communityB}, 'B')`;
    await sql`insert into member (id, community_id, name) values (${memberA}, ${communityA}, 'a'), (${memberB}, ${communityB}, 'b')`;
    await sql`insert into form (id, community_id, title, created_by) values
      (${formA}, ${communityA}, 'Application A', ${memberA}), (${formB}, ${communityB}, 'Application B', ${memberB})`;
    await sql`insert into form_response (id, form_id, values) values (${responseA}, ${formA}, '{}'), (${responseB}, ${formB}, '{}')`;
    await sql`insert into objection (form_response_id, raised_by, note) values
      (${responseA}, ${memberA}, 'concern in A'), (${responseB}, ${memberB}, 'concern in B')`;

    await db.migrateRemaining();

    // Each objection took the community of *its own* form, not one community's
    // for all of them.
    const rows = await sql`select note, community_id, resolution from objection order by note`;
    expect(rows.map((r) => [r.note, r.community_id, r.resolution])).toEqual([
      ["concern in A", communityA, "standing"],
      ["concern in B", communityB, "standing"],
    ]);

    // ...and the column ended up NOT NULL, which is the point of adding it.
    const [col] = await sql`select is_nullable from information_schema.columns
      where table_name = 'objection' and column_name = 'community_id'`;
    expect(col!.is_nullable).toBe("NO");
  });

  // 0082 is the privacy-significant backfill: a community that already had
  // emergency access on has answers nobody agreed to have that reach, and
  // backfilling "true" would grant it retroactively. It must fail closed.
  it("0082 withholds emergency consent from answers that predate it, and keeps what was already agreed", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0082_emergency_consent");
    const sql = db.sql;

    const [communityId, memberId, restricted, plain, other] = Array.from({ length: 5 }, uuid);
    await sql`insert into community (id, name) values (${communityId}, 'C')`;
    await sql`insert into member (id, community_id, name) values (${memberId}, ${communityId}, 'm')`;
    // Sensitive and emergency-reachable: the case the migration is about.
    await sql`insert into profile_question (id, community_id, label, response_type, scope, sensitive, emergency_access)
      values (${restricted}, ${communityId}, 'Medication', 'text', 'once_ever', true, true)`;
    // Not emergency-reachable: nothing to withhold.
    await sql`insert into profile_question (id, community_id, label, response_type, scope, sensitive, emergency_access)
      values (${plain}, ${communityId}, 'Pronouns', 'text', 'once_ever', false, false)`;
    await sql`insert into profile_question (id, community_id, label, response_type, scope, sensitive, emergency_access)
      values (${other}, ${communityId}, 'Allergies', 'text', 'once_ever', true, true)`;

    const answers = {
      answeredShared: uuid(),
      answeredUnshared: uuid(),
      declined: uuid(),
      notEmergency: uuid(),
    };
    await sql`insert into profile_answer (id, member_id, question_id, status, value, share_with_audience) values
      (${answers.answeredShared}, ${memberId}, ${restricted}, 'answered', '"x"', true),
      (${answers.answeredUnshared}, ${memberId}, ${other}, 'answered', '"y"', false),
      (${answers.declined}, ${memberId}, ${other}, 'declined', null, true),
      (${answers.notEmergency}, ${memberId}, ${plain}, 'answered', '"z"', true)`;

    await db.migrateRemaining();

    const consent = async (id: string) =>
      (await sql`select emergency_consent from profile_answer where id = ${id}`)[0]!.emergency_consent;
    // Shared with an audience and now emergency-reachable: nobody agreed, so no.
    expect(await consent(answers.answeredShared)).toBe(false);
    // Un-ticking "share with audience" already meant emergency-only: that was the agreement.
    expect(await consent(answers.answeredUnshared)).toBe(true);
    // A decline holds no value, so there is nothing to reach.
    expect(await consent(answers.declined)).toBe(true);
    // A question that was never emergency-reachable is unaffected.
    expect(await consent(answers.notEmergency)).toBe(true);
  });

  // 0085 gives every existing member a primary contact method, seeded from the
  // address they already sign in with. The cases are the ways that can go
  // wrong on real data: two identities for one member, a member who already
  // has a primary, and one who already added their login address themselves.
  it("0085 seeds one primary contact method per member without disturbing what they already have", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0085_seed_primary_contact_method");
    const sql = db.sql;

    const communityId = uuid();
    const ids = {
      magic: uuid(),
      oidc: uuid(),
      both: uuid(),
      hasPrimary: uuid(),
      addedOwn: uuid(),
    };
    await sql`insert into community (id, name) values (${communityId}, 'C')`;
    for (const [name, id] of Object.entries(ids)) {
      await sql`insert into member (id, community_id, name) values (${id}, ${communityId}, ${name})`;
    }
    await sql`insert into member_identity (member_id, provider, provider_subject, login_email) values
      (${ids.magic}, 'magic_link', null, 'magic@example.org'),
      (${ids.oidc}, 'oidc', 'sub-oidc', 'oidc@example.org'),
      (${ids.both}, 'oidc', 'sub-both', 'both@example.org'),
      (${ids.both}, 'magic_link', null, 'both@example.org'),
      (${ids.hasPrimary}, 'magic_link', null, 'primary@example.org'),
      (${ids.addedOwn}, 'magic_link', null, 'own@example.org')`;
    await sql`insert into contact_method (member_id, type, value, visibility, is_primary) values
      (${ids.hasPrimary}, 'email', 'chosen@example.org', 'everyone', true),
      (${ids.addedOwn}, 'email', 'OWN@example.org', 'task_or_group_mates', false)`;

    await db.migrateRemaining();

    const methods = async (id: string) =>
      sql`select value, visibility, is_primary, verified_at is not null as verified
          from contact_method where member_id = ${id} order by value`;

    // A magic-link identity is provably verified: a link only ever goes to an address.
    const magic = await methods(ids.magic);
    expect(magic.map((m) => [m.value, m.visibility, m.is_primary, m.verified])).toEqual([
      ["magic@example.org", "emergency_only", true, true],
    ]);

    // An OIDC identity's email_verified claim was never stored, so "unknown"
    // must not be written down as a yes.
    const oidc = await methods(ids.oidc);
    expect(oidc.map((m) => [m.is_primary, m.verified])).toEqual([[true, false]]);

    // Two identities, one primary: two would break the invariant the feature rests on.
    const both = await methods(ids.both);
    expect(both).toHaveLength(1);
    expect(both[0]!.is_primary).toBe(true);
    expect(both[0]!.verified).toBe(true);

    // Someone who already chose a primary keeps exactly that, and gets nothing added.
    const hasPrimary = await methods(ids.hasPrimary);
    expect(hasPrimary.map((m) => [m.value, m.visibility])).toEqual([["chosen@example.org", "everyone"]]);

    // Someone who added their login address themselves isn't given a duplicate,
    // and their own choice of visibility isn't overwritten by the migration's.
    const addedOwn = await methods(ids.addedOwn);
    expect(addedOwn.map((m) => [m.value, m.visibility, m.is_primary])).toEqual([
      ["OWN@example.org", "task_or_group_mates", false],
    ]);
  });

  // 0087 (first-login screen) leaves profile_completed_at empty for everyone
  // who already exists, on purpose: the whole current roster is offered the
  // screen at next login. Backfilling it would silently skip them.
  it("0087 leaves every existing member unasked, so the whole roster is offered the first-login screen", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0087_first_login_profile");
    const sql = db.sql;

    const communityId = uuid();
    await sql`insert into community (id, name) values (${communityId}, 'C')`;
    await sql`insert into member (community_id, name) values (${communityId}, 'one'), (${communityId}, 'two')`;

    await db.migrateRemaining();

    const rows = await sql`select profile_completed_at from member`;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.profile_completed_at === null)).toBe(true);
  });
});
