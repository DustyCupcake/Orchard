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
  // 0089 carries every community's four lanes over as rows. The ways this
  // can go wrong on real data: a community with no joining_lane rows at all
  // (the defaults are read live from code, never snapshotted, so "no rows"
  // is the *normal* state, not an edge case), one that had edited its rows,
  // and one that had opted into nomination — the one carry that needs a
  // decision rather than a copy.
  it("0089 carries four lanes over per community, keeping each community's own configuration", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0089_admission_lane");
    const sql = db.sql;

    const [plain, edited, nominating] = Array.from({ length: 3 }, uuid);
    await sql`insert into community (id, name, recruitment_evaluator_count) values
      (${plain}, 'Never configured', 3),
      (${edited}, 'Edited', 2),
      (${nominating}, 'Nominating', 2)`;

    // One community edited its community-wide rows: knows-personally now
    // wants an interview, and the public lane wants the community check.
    await sql`insert into joining_lane (community_id, cycle_id, lane, verification_mode, support_count, application_required, interview_required) values
      (${edited}, null, 'invited_knows_personally', 'basic', 1, false, true),
      (${edited}, null, 'public_application', 'consensus', 1, true, true)`;

    // And one opted into nomination on the public lane, with a support
    // count of 2 — the carry that has to translate, not copy.
    await sql`insert into joining_lane (community_id, cycle_id, lane, verification_mode, support_count, application_required, interview_required) values
      (${nominating}, null, 'public_application', 'nomination', 2, true, true)`;

    await db.migrateRemaining();

    const rows = await sql`
      select l.community_id, l.name, l.kind, l.handles_knows_personally, l.handles_good_fit_only,
             l.handles_neither, l.public_slug, l.application_required, l.interview_required,
             l.verification, l.reports_needed, l.support_shortcut_count
      from admission_lane l order by l.community_id, l.name`;

    // Four lanes for every community, never three or five.
    expect(rows.filter((r) => r.community_id === plain)).toHaveLength(4);
    expect(rows.filter((r) => r.community_id === edited)).toHaveLength(4);
    expect(rows.filter((r) => r.community_id === nominating)).toHaveLength(4);

    // A community with no joining_lane rows gets the documented defaults.
    const plainLane = (name: string) => rows.find((r) => r.community_id === plain && r.name === name)!;
    expect(plainLane("Invited — knows personally")).toMatchObject({
      kind: "invite", handles_knows_personally: true, handles_good_fit_only: false,
      handles_neither: false, application_required: false, interview_required: false,
      verification: "none", reports_needed: null, support_shortcut_count: null,
    });
    expect(plainLane("Invited — vouches (good fit)")).toMatchObject({
      kind: "invite", handles_good_fit_only: true, handles_knows_personally: false,
      application_required: true, interview_required: true, verification: "none",
      reports_needed: 3,
    });
    expect(plainLane("Open application")).toMatchObject({
      kind: "public", application_required: true, interview_required: true,
      verification: "none", reports_needed: 3,
    });

    // The edited community keeps its own configuration, per lane: the one it
    // edited came across, the two it never touched are the defaults.
    const editedLane = (name: string) => rows.find((r) => r.community_id === edited && r.name === name)!;
    expect(editedLane("Invited — knows personally")).toMatchObject({
      application_required: false, interview_required: true, verification: "none",
      // An interview means there is something to evaluate, so reports
      // needed becomes the community's count where the default left it null.
      reports_needed: 2,
    });
    expect(editedLane("Open application")).toMatchObject({ verification: "community_check" });

    // Nomination carries across as the support shortcut, keeping the
    // community's own count of 2. Verification becomes none because
    // nomination as a *wait* is what the plan deletes — but the intent
    // behind it (other members' word) survives as a shortcut.
    expect(rows.find((r) => r.community_id === nominating && r.name === "Open application"))
      .toMatchObject({ verification: "none", support_shortcut_count: 2, reports_needed: 2 });

    // The three inviter declarations are each handled by exactly one lane,
    // which is what keeps an invite from having nowhere to go (§2a).
    for (const communityId of [plain, edited, nominating]) {
      const own = rows.filter((r) => r.community_id === communityId);
      for (const col of ["handles_knows_personally", "handles_good_fit_only", "handles_neither"]) {
        expect(own.filter((r: Record<string, unknown>) => r[col])).toHaveLength(1);
      }
      // Exactly one public lane, and it has no inviter declarations.
      const publics = own.filter((r) => r.kind === "public");
      expect(publics).toHaveLength(1);
      expect(publics[0]).toMatchObject({
        handles_knows_personally: false, handles_good_fit_only: false, handles_neither: false,
      });
    }
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

  // 0093 retires per-event override rows in favour of an event choosing which
  // lanes are open (§2a). The ways it can go wrong on real data: an event that
  // overrode only some lanes must still have a lane for *every* kind of
  // arrival (or an invite has nowhere to go there), two events with the same
  // name must not collide on the carried lane's name, an event that overrode
  // nothing must be left following the community, and nothing may leak into
  // the community's own door.
  it("0093 turns each event's overrides into lanes open only there, and leaves other events following the community", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0089_admission_lane");
    const sql = db.sql;

    const [communityId, plainEvent, overriddenEvent, twinA, twinB] = Array.from({ length: 5 }, uuid);
    await sql`insert into community (id, name) values (${communityId}, 'C')`;
    await sql`insert into cycle (id, community_id, name) values
      (${plainEvent}, ${communityId}, 'Plain'),
      (${overriddenEvent}, ${communityId}, 'Reunion'),
      (${twinA}, ${communityId}, 'Twin'),
      (${twinB}, ${communityId}, 'Twin')`;
    // Reunion overrode two lanes: knows-personally now wants a community check,
    // and the public application wants nothing at all but the support of two.
    await sql`insert into joining_lane (community_id, cycle_id, lane, verification_mode, support_count, application_required, interview_required) values
      (${communityId}, ${overriddenEvent}, 'invited_knows_personally', 'consensus', 1, false, false),
      (${communityId}, ${overriddenEvent}, 'public_application', 'nomination', 2, true, false),
      (${communityId}, ${twinA}, 'invited_neither', 'basic', 1, false, false),
      (${communityId}, ${twinB}, 'invited_neither', 'basic', 1, true, false)`;

    await db.migrateRemaining();

    const lanes = await sql`select id, name, kind, verification, application_required, interview_required, support_shortcut_count, open_in_community
                            from admission_lane where community_id = ${communityId}`;
    const byName = new Map(lanes.map((l) => [l.name as string, l]));

    // The community's own four, untouched and open at its door.
    for (const name of ["Invited — knows personally", "Invited — vouches (good fit)", "Invited — neither mark", "Open application"]) {
      expect(byName.get(name)).toMatchObject({ open_in_community: true });
    }
    // Four overrides became four new lanes, open nowhere but their event, and
    // the two same-named events got distinct names rather than a unique-index
    // failure that would have rolled the whole migration back.
    const carried = lanes.filter((l) => !l.open_in_community);
    expect(carried).toHaveLength(4);
    expect(new Set(carried.map((l) => l.name)).size).toBe(4);
    const reunionKnows = byName.get("Invited — knows personally — Reunion")!;
    expect(reunionKnows).toMatchObject({ verification: "community_check", application_required: false });
    expect(byName.get("Open application — Reunion")).toMatchObject({
      verification: "none", support_shortcut_count: 2, interview_required: false,
    });

    // Every event with overrides has its own set, and every set covers every
    // kind of arrival exactly once: the carried lane where it overrode, the
    // community's own lane everywhere else.
    const sets = await sql`select c.id as cycle_id, c.own_admission_lanes, l.name, l.kind, l.handles_knows_personally, l.handles_good_fit_only, l.handles_neither
                           from cycle c left join cycle_admission_lane cl on cl.cycle_id = c.id left join admission_lane l on l.id = cl.lane_id
                           where c.community_id = ${communityId}`;
    const setOf = (cycleId: string) => sets.filter((r) => r.cycle_id === cycleId && r.name);
    expect(sets.find((r) => r.cycle_id === plainEvent)!.own_admission_lanes).toBe(false);
    expect(setOf(plainEvent)).toHaveLength(0);

    const reunion = setOf(overriddenEvent);
    expect(reunion.map((r) => r.name).sort()).toEqual([
      "Invited — knows personally — Reunion",
      "Invited — neither mark",
      "Invited — vouches (good fit)",
      "Open application — Reunion",
    ]);
    for (const col of ["handles_knows_personally", "handles_good_fit_only", "handles_neither"]) {
      expect(reunion.filter((r) => r[col])).toHaveLength(1);
    }
    expect(reunion.filter((r) => r.kind === "public")).toHaveLength(1);

    // The twins each got their own override, not each other's.
    expect(setOf(twinA).find((r) => r.handles_neither)!.name).not.toBe(setOf(twinB).find((r) => r.handles_neither)!.name);
  });
});
