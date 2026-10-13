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
  // 0097 carries every community's four lanes over as rows. The ways this
  // can go wrong on real data: a community with no joining_lane rows at all
  // (the defaults are read live from code, never snapshotted, so "no rows"
  // is the *normal* state, not an edge case), one that had edited its rows,
  // and one that had opted into nomination — the one carry that needs a
  // decision rather than a copy.
  it("0097 carries four lanes over per community, keeping each community's own configuration", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0097_admission_lane");
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

    // Up to 0083 only: it is 0083's own backfill under test, and later migrations
    // (0107) move these rows into the community check — and, rightly, refuse to carry
    // standing concerns that have no arrival, which is what these two are.
    await db.migrateTo("0083_joining_admission_back_end");

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

  // 0101 retires per-event override rows in favour of an event choosing which
  // lanes are open (§2a). The ways it can go wrong on real data: an event that
  // overrode only some lanes must still have a lane for *every* kind of
  // arrival (or an invite has nowhere to go there), two events with the same
  // name must not collide on the carried lane's name, an event that overrode
  // nothing must be left following the community, and nothing may leak into
  // the community's own door.
  it("0101 turns each event's overrides into lanes open only there, and leaves other events following the community", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0097_admission_lane");
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

  // 0102 adds a NOT NULL token to arrivals that already exist. Postgres checks the
  // constraint against existing rows when the column is added, so a plain
  // NOT NULL would fail on any database with an arrival in it — the same shape of
  // failure as 0083. Each existing arrival has to get a token of its own (a
  // shared or guessable one would let anyone vouch for anybody), and 0103 then
  // drops the nomination tables whose job the supports now do.
  it("0102 gives every existing arrival its own support token, and 0103 drops the nomination tables", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0102_admission_support");
    const sql = db.sql;

    const [communityId, laneId] = Array.from({ length: 2 }, uuid);
    await sql`insert into community (id, name) values (${communityId}, 'C')`;
    await sql`insert into admission_lane (id, community_id, name, kind) values (${laneId}, ${communityId}, 'Open', 'public')`;
    await sql`insert into admission (community_id, email, name, lane_id, route, token) values
      (${communityId}, 'a@example.com', 'A', ${laneId}, 'application', 'token-a'),
      (${communityId}, 'b@example.com', 'B', ${laneId}, 'application', 'token-b'),
      (${communityId}, 'c@example.com', 'C', ${laneId}, 'application', 'token-c')`;
    const [{ before }] = await sql`select to_regclass('joining_nomination') is not null as before`;
    expect(before).toBe(true);

    await db.migrateRemaining();

    const rows = await sql`select token, support_token from admission order by token`;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.support_token).toMatch(/^[0-9a-f]{64}$/);
      expect(r.support_token).not.toBe(r.token);
    }
    expect(new Set(rows.map((r) => r.support_token)).size).toBe(3);
    const [{ after }] = await sql`select to_regclass('joining_nomination') is null and to_regclass('joining_support') is null as after`;
    expect(after).toBe(true);
  });

  // 0104 replaces the ordered decision rules with a small form. The rules could
  // only say "at least N said X", so the recoverable shapes are few and the carry
  // has to translate each rather than reset every community to the default. The
  // ways it can go wrong on real data: a community with no rules (the normal
  // state — keep the defaults), the common "two yes admit, two no decline,
  // otherwise discuss" shape, a fallback that declines or that admits, and rules
  // that read the inviter's marks, which have no equivalent and must not be
  // half-translated into something that decides differently.
  it("0104 carries each community's decision rules into the form, and drops what has no equivalent", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0104_decision_policy");
    const sql = db.sql;

    const [none, standard, declines, admits, marks] = Array.from({ length: 5 }, uuid);
    await sql`insert into community (id, name, recruitment_evaluator_count, recruitment_decision_rules) values
      (${none}, 'No rules', 2, '[]'::jsonb),
      (${standard}, 'Standard', 3, ${JSON.stringify([
        { conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" },
        { conditions: { minCounts: { decline: 2 } }, outcome: "decline" },
        { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
      ])}::jsonb),
      (${declines}, 'Declines', 2, ${JSON.stringify([{ conditions: {}, outcome: "decline" }])}::jsonb),
      (${admits}, 'Admits on no concern', 2, ${JSON.stringify([{ conditions: {}, outcome: "wider_discussion", defaultResolution: "proceed" }])}::jsonb),
      (${marks}, 'Marks', 2, ${JSON.stringify([
        { conditions: { inviterThinksGoodFit: true }, outcome: "proceed" },
        { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
      ])}::jsonb)`;

    // Up to 0104 only: it is 0104's carry under test, and a later migration drops the old
    // columns it is compared against.
    await db.migrateTo("0104_decision_policy");

    const rows = await sql`select id, recruitment_in_when, recruitment_custom_min_yes, recruitment_custom_max_no,
      recruitment_any_no_means, recruitment_discussion_ends, recruitment_decline_outright_at,
      recruitment_decision_rules from community`;
    const of = (id: string) => rows.find((r) => r.id === id)!;

    // Untouched: the defaults, and the old column still there to compare against.
    expect(of(none)).toMatchObject({
      recruitment_in_when: "no_no_one_yes", recruitment_any_no_means: "wider_discussion",
      recruitment_discussion_ends: "decline", recruitment_decline_outright_at: null,
    });
    // The common shape: "at least 2 yes" in, "at least 2 no" declines, otherwise a
    // discussion that ends in a decline. Out of 3 reports, 2 yes already bounds the no's.
    expect(of(standard)).toMatchObject({
      recruitment_in_when: "custom", recruitment_custom_min_yes: 2, recruitment_custom_max_no: 3,
      recruitment_decline_outright_at: 2, recruitment_any_no_means: "wider_discussion", recruitment_discussion_ends: "decline",
    });
    expect(of(declines)).toMatchObject({ recruitment_any_no_means: "decline", recruitment_in_when: "no_no_one_yes" });
    expect(of(admits)).toMatchObject({ recruitment_any_no_means: "wider_discussion", recruitment_discussion_ends: "admit" });
    // A rule that read the inviter's marks is dropped, not half-translated: only the
    // fallback it came with survives.
    expect(of(marks)).toMatchObject({ recruitment_in_when: "no_no_one_yes", recruitment_decline_outright_at: null, recruitment_discussion_ends: "decline" });
    // The old rules are kept, unread, so the carry can be checked against its source.
    expect(of(standard).recruitment_decision_rules).toHaveLength(3);
  });

  // 0107 moves every window and every concern into the one community check. What
  // could go wrong on real data: a window that is open and must stay open with its
  // own deadline, concerns that must keep their ids (the shield rows are copied by
  // id alone), a settled history that must read back as it was, a decision's wider
  // discussion that becomes an evaluation window saying what a quiet one does, and
  // — the one that must never be silent — a concern still standing with nothing to
  // hang its window on, which stops the migration rather than being dropped.
  async function seedChecks(sql: ScratchDatabase["sql"]) {
    const ids = Object.fromEntries(
      ["community", "alice", "bob", "mira", "lane", "form", "inviteOpen", "inviteDone", "arrivalOpen", "arrivalDone", "arrivalDiscussion", "response", "concernOpen", "concernDone", "concernDiscussion", "decision"].map((k) => [k, uuid()]),
    ) as Record<string, string>;
    await sql`insert into community (id, name, recruitment_wider_discussion_hours) values (${ids.community}, 'C', 24)`;
    await sql`insert into member (id, community_id, name) values (${ids.alice}, ${ids.community}, 'Alice'), (${ids.bob}, ${ids.community}, 'Bob'), (${ids.mira}, ${ids.community}, 'Mira')`;
    await sql`insert into admission_lane (id, community_id, name, kind) values (${ids.lane}, ${ids.community}, 'Check', 'invite')`;
    await sql`insert into form (id, community_id, title, created_by, fields) values (${ids.form}, ${ids.community}, 'Application', ${ids.alice}, '[]'::jsonb)`;
    await sql`insert into form_response (id, form_id, values) values (${ids.response}, ${ids.form}, '{}'::jsonb)`;

    // 1. an invitee whose announced window is still open, with a concern standing on it
    await sql`insert into community_invite (id, community_id, created_by, token, consensus_state, consensus_deadline, consent_at)
      values (${ids.inviteOpen}, ${ids.community}, ${ids.alice}, 'tok-open', 'announced', now() + interval '10 hours', now() - interval '14 hours')`;
    await sql`insert into admission (id, community_id, email, name, lane_id, route, invite_id, token, support_token, required_verification)
      values (${ids.arrivalOpen}, ${ids.community}, 'open@example.com', 'Open', ${ids.lane}, 'invite', ${ids.inviteOpen}, 'tok-a', 'sup-a', 'community_check')`;
    await sql`insert into objection (id, community_id, invite_id, raised_by, note) values (${ids.concernOpen}, ${ids.community}, ${ids.inviteOpen}, ${ids.bob}, 'still open')`;
    await sql`insert into objection_party_exclusion (objection_id, member_id, added_by) values (${ids.concernOpen}, ${ids.mira}, ${ids.bob})`;
    await sql`insert into objection_party_consent (objection_id, member_id, note) values (${ids.concernOpen}, ${ids.alice}, 'tell her')`;

    // 2. an invitee admitted after a concern was cleared
    await sql`insert into community_invite (id, community_id, created_by, token, consensus_state, consensus_deadline, consent_at)
      values (${ids.inviteDone}, ${ids.community}, ${ids.alice}, 'tok-done', 'admitted', now() - interval '3 hours', now() - interval '30 hours')`;
    await sql`insert into admission (id, community_id, email, name, lane_id, route, invite_id, token, support_token, required_verification, admitted_at, admitted_member_id)
      values (${ids.arrivalDone}, ${ids.community}, 'done@example.com', 'Done', ${ids.lane}, 'invite', ${ids.inviteDone}, 'tok-b', 'sup-b', 'community_check', now() - interval '2 hours', ${ids.alice})`;
    await sql`insert into objection (id, community_id, invite_id, raised_by, note, resolution, resolved_at, resolved_by_id, resolution_note)
      values (${ids.concernDone}, ${ids.community}, ${ids.inviteDone}, ${ids.bob}, 'was cleared', 'cleared', now() - interval '4 hours', ${ids.mira}, 'we talked')`;
    await sql`insert into objection_overrule_support (objection_id, member_id, note) values (${ids.concernDone}, ${ids.mira}, 'would have')`;

    // 3. an application whose reports led to a wider discussion that defaults to admitting
    await sql`insert into admission (id, community_id, email, name, lane_id, route, form_response_id, token, support_token)
      values (${ids.arrivalDiscussion}, ${ids.community}, 'talk@example.com', 'Talk', ${ids.lane}, 'application', ${ids.response}, 'tok-c', 'sup-c')`;
    await sql`insert into recruitment_decision (id, form_response_id, rule_outcome, default_resolution, wider_discussion_deadline)
      values (${ids.decision}, ${ids.response}, 'wider_discussion', 'proceed', now() + interval '5 hours')`;
    await sql`insert into objection (id, community_id, form_response_id, raised_by, note) values (${ids.concernDiscussion}, ${ids.community}, ${ids.response}, ${ids.bob}, 'about the application')`;
    return ids;
  }

  it("0107 carries every window and concern into the one check, keeping ids, deadlines and the shield", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0106_drop_unused_check_tables");
    const sql = db.sql;
    const ids = await seedChecks(sql);

    await db.migrateRemaining();

    const checks = await sql`select arrival_id, kind, on_quiet, window_hours, deadline, ended_at, ended_as from community_check`;
    const of = (arrivalId: string) => checks.find((c) => c.arrival_id === arrivalId)!;

    // The open window stays open, with the deadline it already had.
    expect(of(ids.arrivalOpen)).toMatchObject({ kind: "entry", on_quiet: "continue", window_hours: 24, ended_at: null, ended_as: null });
    expect(new Date(of(ids.arrivalOpen).deadline).getTime()).toBeGreaterThan(Date.now() + 9 * 3_600_000);
    // The finished one is history: ended, and ended by a cleared concern.
    expect(of(ids.arrivalDone)).toMatchObject({ kind: "entry", ended_as: "cleared" });
    expect(of(ids.arrivalDone).ended_at).not.toBeNull();
    // A wider discussion that defaulted to proceed now says so, and is still open.
    expect(of(ids.arrivalDiscussion)).toMatchObject({ kind: "evaluation", on_quiet: "admit", ended_at: null });

    // Every concern kept its id, its words and its state; none is lost, none duplicated.
    const concerns = await sql`select id, note, resolution, raised_by_id, resolved_by_id, resolution_note from community_check_concern order by note`;
    expect(concerns).toHaveLength(3);
    expect(concerns.find((c) => c.id === ids.concernOpen)).toMatchObject({ note: "still open", resolution: "standing", raised_by_id: ids.bob });
    expect(concerns.find((c) => c.id === ids.concernDone)).toMatchObject({ resolution: "cleared", resolved_by_id: ids.mira, resolution_note: "we talked" });
    expect(concerns.find((c) => c.id === ids.concernDiscussion)).toMatchObject({ resolution: "standing" });

    // The shield came across by id: who was recused, who may be told, who would overrule.
    const [exclusion] = await sql`select concern_id, member_id, added_by_id from community_check_concern_exclusion`;
    expect(exclusion).toMatchObject({ concern_id: ids.concernOpen, member_id: ids.mira, added_by_id: ids.bob });
    const [consent] = await sql`select concern_id, member_id, note from community_check_concern_consent`;
    expect(consent).toMatchObject({ concern_id: ids.concernOpen, member_id: ids.alice, note: "tell her" });
    const [support] = await sql`select concern_id, member_id, note from community_check_overrule_support`;
    expect(support).toMatchObject({ concern_id: ids.concernDone, member_id: ids.mira, note: "would have" });

    // And the old shapes are gone.
    const [{ gone }] = await sql`select to_regclass('objection') is null and to_regclass('objection_party_exclusion') is null as gone`;
    expect(gone).toBe(true);
    const cols = await sql`select column_name from information_schema.columns where table_name = 'community_invite' and column_name like 'consensus%'`;
    expect(cols).toHaveLength(0);
  });

  it("0107 stops rather than drop a standing concern that has no arrival to belong to", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0106_drop_unused_check_tables");
    const sql = db.sql;
    const [communityId, bob, formId, responseId] = Array.from({ length: 4 }, uuid);
    await sql`insert into community (id, name) values (${communityId}, 'C')`;
    await sql`insert into member (id, community_id, name) values (${bob}, ${communityId}, 'Bob')`;
    await sql`insert into form (id, community_id, title, created_by, fields) values (${formId}, ${communityId}, 'Application', ${bob}, '[]'::jsonb)`;
    await sql`insert into form_response (id, form_id, values) values (${responseId}, ${formId}, '{}'::jsonb)`;
    // An application that predates arrivals, with a concern standing on it.
    await sql`insert into objection (community_id, form_response_id, raised_by, note) values (${communityId}, ${responseId}, ${bob}, 'standing')`;

    await expect(db.migrateRemaining()).rejects.toThrow(/standing concern has no arrival/);
  });

  // 0109 keys reports and decisions on the arrival. Existing ones have to land on the arrival
  // their application made — not on one of another person's — and one whose application has no
  // arrival yet must keep working (it is linked when the arrival is made), so the column is
  // nullable and the application key stays.
  it("0109 gives existing reports and decisions the arrival their application made, and leaves orphans alone", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0109_reports_keyed_on_arrival");
    const sql = db.sql;
    const [communityId, lane, alice, bob, form, respA, respB, respOrphan, arrA, arrB] = Array.from({ length: 10 }, uuid);
    await sql`insert into community (id, name) values (${communityId}, 'C')`;
    await sql`insert into member (id, community_id, name) values (${alice}, ${communityId}, 'Alice')`;
    await sql`insert into member (id, community_id, name) values (${bob}, ${communityId}, 'Bob')`;
    await sql`insert into admission_lane (id, community_id, name, kind) values (${lane}, ${communityId}, 'Open', 'public')`;
    await sql`insert into form (id, community_id, title, created_by, fields) values (${form}, ${communityId}, 'A', ${alice}, '[]'::jsonb)`;
    await sql`insert into form_response (id, form_id, values) values (${respA}, ${form}, '{}'::jsonb), (${respB}, ${form}, '{}'::jsonb), (${respOrphan}, ${form}, '{}'::jsonb)`;
    await sql`insert into admission (id, community_id, email, name, lane_id, route, form_response_id, token, support_token) values
      (${arrA}, ${communityId}, 'a@example.com', 'A', ${lane}, 'application', ${respA}, 'ta', 'sa'),
      (${arrB}, ${communityId}, 'b@example.com', 'B', ${lane}, 'application', ${respB}, 'tb', 'sb')`;
    await sql`insert into evaluation (form_response_id, evaluator_id, recommendation) values
      (${respA}, ${alice}, 'proceed'), (${respB}, ${alice}, 'decline'), (${respOrphan}, ${alice}, 'unsure')`;
    await sql`insert into recruitment_decision (form_response_id, rule_outcome) values (${respA}, 'proceed'), (${respOrphan}, 'decline')`;

    await db.migrateRemaining();

    const reports = await sql`select form_response_id, arrival_id from evaluation`;
    const of = (r: string) => reports.find((x) => x.form_response_id === r)!;
    expect(of(respA).arrival_id).toBe(arrA);
    expect(of(respB).arrival_id).toBe(arrB);
    expect(of(respOrphan).arrival_id).toBeNull();
    const decisions = await sql`select form_response_id, arrival_id from recruitment_decision`;
    expect(decisions.find((d) => d.form_response_id === respA)!.arrival_id).toBe(arrA);
    expect(decisions.find((d) => d.form_response_id === respOrphan)!.arrival_id).toBeNull();
    // A report with no application is now possible, and it is the arrival's.
    await sql`insert into evaluation (arrival_id, evaluator_id, recommendation) values (${arrA}, ${bob}, 'unsure')`;
    // …but not two from the same person about the same arrival.
    await expect(sql`insert into evaluation (arrival_id, evaluator_id, recommendation) values (${arrA}, ${bob}, 'proceed')`).rejects.toThrow();
  });

  // 0112 moves each pair onto the arrivals its applications made, and the clean-up migration
  // after it drops the response columns it replaced. A pair whose application has no arrival
  // yet keeps no pointer (the arrival is made lazily, and there is nothing to point at), so the
  // test pins what is carried and that nothing else is invented.
  it("0112 carries pairs onto arrivals, and the clean-up drops the old columns and tables", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0112_pairing_on_arrivals");
    const sql = db.sql;
    const [communityId, lane, alice, form, respA, respB, respC, arrA, arrB] = Array.from({ length: 9 }, uuid);
    await sql`insert into community (id, name) values (${communityId}, 'C')`;
    await sql`insert into member (id, community_id, name) values (${alice}, ${communityId}, 'Alice')`;
    await sql`insert into admission_lane (id, community_id, name, kind) values (${lane}, ${communityId}, 'Open', 'public')`;
    await sql`insert into form (id, community_id, title, created_by, fields) values (${form}, ${communityId}, 'A', ${alice}, '[]'::jsonb)`;
    await sql`insert into form_response (id, form_id, values) values (${respA}, ${form}, '{}'::jsonb), (${respB}, ${form}, '{}'::jsonb), (${respC}, ${form}, '{}'::jsonb)`;
    await sql`insert into admission (id, community_id, email, name, lane_id, route, form_response_id, token, support_token) values
      (${arrA}, ${communityId}, 'a@example.com', 'A', ${lane}, 'application', ${respA}, 'ta', 'sa'),
      (${arrB}, ${communityId}, 'b@example.com', 'B', ${lane}, 'application', ${respB}, 'tb', 'sb')`;
    await sql`insert into recruitment_pair (community_id, token, requested_by_id, first_response_id, second_response_id, status) values
      (${communityId}, 'pair-1', ${alice}, ${respA}, ${respB}, 'accepted'),
      (${communityId}, 'pair-2', ${alice}, ${respA}, ${respC}, 'awaiting_accept')`;

    await db.migrateRemaining();

    const pairs = await sql`select token, first_arrival_id, second_arrival_id, linked_by_team from recruitment_pair order by token`;
    expect(pairs[0]).toMatchObject({ token: "pair-1", first_arrival_id: arrA, second_arrival_id: arrB, linked_by_team: false });
    // The second application has no arrival, so there is nothing to carry for that side.
    expect(pairs[1]).toMatchObject({ token: "pair-2", first_arrival_id: arrA, second_arrival_id: null });

    const [{ gone }] = await sql`select to_regclass('joining_lane') is null as gone`;
    expect(gone).toBe(true);
    const cols = await sql`select column_name from information_schema.columns
      where (table_name = 'recruitment_pair' and column_name in ('first_response_id', 'second_response_id'))
         or (table_name = 'community' and column_name in ('recruitment_decision_rules', 'recruitment_evaluator_count', 'recruitment_nomination_window_hours', 'recruitment_subscription_lapse_threshold'))
         or (table_name = 'recruitment_decision' and column_name in ('intro_call_poll_id', 'intro_call_token'))
         or (table_name = 'member' and column_name = 'joined_via_invite_id')`;
    expect(cols).toHaveLength(0);
  });

  // 0114 gives every accompaniment that already exists a row of its own. Until then the only
  // record was the decision that made the task, so a row is made for each decision that has both
  // a task and the member it is for; a finished task is an accompaniment already over, and a
  // current holder is recorded as already announced so long-standing pairs are not emailed.
  it("0114 carries existing accompaniments onto rows, and leaves the rest alone", async () => {
    db = await createScratchDatabase();
    await db.migrateBefore("0114_accompaniment");
    const sql = db.sql;
    const [communityId, alice, bob, dana, erin, frank, branchId, open, finished, unconverted, formId, r1, r2, r3] = Array.from({ length: 14 }, uuid);
    await sql`insert into community (id, name) values (${communityId}, 'C')`;
    await sql`insert into member (id, community_id, name) values (${alice}, ${communityId}, 'Alice'), (${bob}, ${communityId}, 'Bob'), (${dana}, ${communityId}, 'Dana'), (${erin}, ${communityId}, 'Erin'), (${frank}, ${communityId}, 'Frank')`;
    await sql`insert into branch (id, community_id, name) values (${branchId}, ${communityId}, 'Seed')`;
    await sql`insert into task (id, community_id, branch_id, title, effort, effort_magnitude, created_by, status) values
      (${open}, ${communityId}, ${branchId}, 'Accompany new member', 'owns_a_thing', '{}'::jsonb, ${alice}, 'claimed'),
      (${finished}, ${communityId}, ${branchId}, 'Accompany new member', 'owns_a_thing', '{}'::jsonb, ${alice}, 'done'),
      (${unconverted}, ${communityId}, ${branchId}, 'Accompany new member', 'owns_a_thing', '{}'::jsonb, ${alice}, 'unclaimed')`;
    await sql`insert into task_assignment (task_id, member_id) values (${open}, ${bob})`;
    await sql`insert into form (id, community_id, title, created_by, fields) values (${formId}, ${communityId}, 'A', ${alice}, '[]'::jsonb)`;
    await sql`insert into form_response (id, form_id, values) values (${r1}, ${formId}, '{}'::jsonb), (${r2}, ${formId}, '{}'::jsonb), (${r3}, ${formId}, '{}'::jsonb)`;
    await sql`insert into recruitment_decision (form_response_id, rule_outcome, resolution, accompaniment_task_id, converted_member_id) values
      (${r1}, 'proceed', 'accepted', ${open}, ${dana}),
      (${r2}, 'proceed', 'accepted', ${finished}, ${erin}),
      (${r3}, 'proceed', 'accepted', ${unconverted}, null)`;

    await db.migrateRemaining();

    const rows = await sql`select member_id, task_id, ended_at, announced_holder_id, ends_on - started_at as span from accompaniment order by member_id`;
    // Frank has no decision, and the third decision never made a member: nothing is invented for either.
    expect(rows).toHaveLength(2);
    const of = (m: string) => rows.find((r) => r.member_id === m)!;
    expect(of(dana)).toMatchObject({ task_id: open, ended_at: null, announced_holder_id: bob });
    expect(of(erin)).toMatchObject({ task_id: finished, announced_holder_id: null });
    expect(of(erin).ended_at).not.toBeNull();
    expect(of(dana).span).toBe("90 days");
    // A community that did nothing keeps what it always had.
    const [c] = await sql`select accompaniment_enabled, accompaniment_tier_id, accompaniment_ends_after_days from community`;
    expect(c).toMatchObject({ accompaniment_enabled: true, accompaniment_tier_id: null, accompaniment_ends_after_days: 90 });
    // One open accompaniment per member, enforced.
    await expect(
      sql`insert into accompaniment (community_id, member_id, task_id, ends_on) values (${communityId}, ${dana}, ${open}, now())`,
    ).rejects.toThrow();
  });
});
