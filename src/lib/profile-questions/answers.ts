import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycle, profileAnswer, profileQuestion } from "@/db/schema";
import type { member as memberTable, profileQuestion as profileQuestionTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { toFieldShape, validateFieldValue, type TextValidation } from "../field-shape";
import { phaseForCycle } from "./capacity";
import { getMemberDeclaredCycleId } from "../participation";
import { resolveReadableQuestions } from "../sensitive-data";

type Member = typeof memberTable.$inferSelect;
type ProfileQuestion = typeof profileQuestionTable.$inferSelect;

// The one validation path for an answer's value, shared with Form
// submissions via src/lib/field-shape.ts. Used to be a per-responseType
// if/else chain here; it's now the same code that renders the field, so
// a shape a form would accept can't be rejected as a profile answer or
// vice versa. `allowBlank: true` throughout: a ProfileQuestion is
// answered one at a time and is always skippable, so "blank" is never
// an error — it's just an answer this member hasn't given yet, which is
// what listOutstandingQuestions then reports.
function validateValue(question: ProfileQuestion, value: unknown) {
  return validateFieldValue(
    toFieldShape({
      responseType: question.responseType,
      options: question.options,
      multiline: question.multiline,
      validation: question.validation as TextValidation,
      allowOther: question.allowOther,
      min: question.min,
      max: question.max,
      step: question.step,
    }),
    value,
    { allowBlank: true },
  );
}

export const submitAnswerInput = z.object({
  status: z.enum(["answered", "deferred", "declined"]),
  value: z.unknown().optional(),
  capacityVisibility: z.enum(["flag_only", "open"]).optional(),
  // Which cycle a per_cycle/phase answer stamps against, when the caller
  // knows it outright. Omit it and the member's own declared cycle is used,
  // exactly as before — this exists for surfaces that are explicitly about
  // one event (the Dashboard/Community declare-joining controls sending
  // someone to /questions?cycle=…), where "whatever cycle they happen to
  // have declared on" would be the wrong answer. Validated against the
  // actor's own community and open lifecycle on the write side below.
  cycleId: z.string().min(1).nullable().optional(),
  // Whether this answer is in the configured audience's reach, on a
  // *sensitive* question. Only offered there, and forced back to true
  // elsewhere — see the write side below for why the column can never be
  // allowed to disagree with the question it belongs to.
  shareWithAudience: z.boolean().optional(),
});
export type SubmitAnswerInput = z.infer<typeof submitAnswerInput>;


// An explicitly-requested cycle still has to be one of the actor's own
// community's *open* cycles — a client-supplied uuid is not trusted to name
// an event, same posture requireCycleInCommunity (../participation.ts) takes
// on the write path. Never reach here from a surface that can name a
// foreign cycle: this throws rather than silently falling back, so a
// mis-wired caller fails loudly instead of stamping an answer somewhere
// arbitrary.
async function requireOpenCycleInCommunity(actor: Member, cycleId: string) {
  const [row] = await db
    .select({ id: cycle.id, closedAt: cycle.closedAt })
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Event not found");
  }
  if (row.closedAt) {
    throw new ConflictError("That event is closed");
  }
  return row.id;
}

// Read-side counterpart to requireOpenCycleInCommunity above: null instead
// of a throw, since the only caller is a query-string-driven read.
async function knownOpenCycleId(actor: Member, cycleId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: cycle.id })
    .from(cycle)
    .where(
      and(
        eq(cycle.id, cycleId),
        eq(cycle.communityId, actor.communityId),
        isNull(cycle.closedAt),
      ),
    );
  return row?.id ?? null;
}

// Which cycle a per_cycle/phase answer stamps against — null for
// once_ever (see profile-question.ts's schema comment). `requested` is an
// explicit cycle from the caller (submitAnswerInput.cycleId above); without
// one this is the member's own declared cycle (docs/development-plan.md's
// Phase 65), not whichever cycle the nav's view-scope switcher happens to be
// on right now — glancing at a different cycle in the nav should never
// change what a member's own answer stamps against. Throws if a per_cycle/
// phase question is answered with no such cycle to stamp it against; in
// practice this shouldn't happen since such a question wouldn't have appeared
// in listOutstandingQuestions() either.
async function resolveCycleId(
  actor: Member,
  question: ProfileQuestion,
  requested?: string | null,
): Promise<string | null> {
  if (question.scope === "once_ever") return null;
  if (requested) return requireOpenCycleInCommunity(actor, requested);
  const cycleId = await getMemberDeclaredCycleId(actor);
  if (!cycleId) {
    throw new ConflictError("No current event to answer this against");
  }
  return cycleId;
}

export async function answerProfileQuestion(
  actor: Member,
  questionId: string,
  input: SubmitAnswerInput,
) {
  const [question] = await db
    .select()
    .from(profileQuestion)
    .where(and(eq(profileQuestion.id, questionId), eq(profileQuestion.communityId, actor.communityId)));
  if (!question || question.archivedAt) {
    throw new NotFoundError("Profile question not found");
  }

  const value = input.status === "answered" ? validateValue(question, input.value) : null;
  // "Prefer not to say" only exists on questions that offer it. A client
  // that sends `declined` for one that doesn't is not making a choice
  // the community offered, so it's rejected rather than quietly stored —
  // otherwise a member could decline a question nobody said they could
  // decline, and it'd read as though they had.
  if (input.status === "declined" && !question.allowPreferNotToSay) {
    throw new ConflictError("This question doesn't offer a prefer-not-to-say option");
  }
  const cycleId = await resolveCycleId(actor, question, input.cycleId);

  const [existing] = await db
    .select()
    .from(profileAnswer)
    .where(
      and(
        eq(profileAnswer.memberId, actor.id),
        eq(profileAnswer.questionId, questionId),
        cycleId ? eq(profileAnswer.cycleId, cycleId) : isNull(profileAnswer.cycleId),
      ),
    );

  const row = {
    status: input.status,
    value,
    capacityVisibility: input.capacityVisibility ?? "flag_only",
    // Forced true on a non-sensitive question, whatever the client sent.
    // There is nobody to reduce the exposure *from* — the answer is
    // already readable by the whole community — so a stored false would
    // be a claim about the world that isn't true, and the read side would
    // then have to special-case it. Making it unreachable here is better
    // than making every reader remember.
    shareWithAudience: question.sensitive ? (input.shareWithAudience ?? true) : true,
    answeredAt: new Date(),
  } as const;

  if (existing) {
    const [updated] = await db
      .update(profileAnswer)
      .set(row)
      .where(eq(profileAnswer.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(profileAnswer)
    .values({ memberId: actor.id, questionId, cycleId, ...row })
    .returning();
  return created;
}

export type OutstandingQuestion = {
  question: ProfileQuestion;
  existingAnswer: typeof profileAnswer.$inferSelect | null;
};

// Profile page, /questions: which questions does this member have no real answer
// for yet — no answer at all, or a deferred one (see spec's
// "Surfacing"). A per_cycle/phase question that can't resolve to a
// current cycle/phase at all just doesn't appear, same as it wouldn't
// on any other surface.
//
// `options.surface`, when given, additionally narrows to questions
// whose `surfaces` array names it — e.g. Dashboard's onboarding panel
// (docs/development-plan.md's Phase 56) passes "onboarding" so it only
// ever surfaces questions a community actually opted into that flow,
// never every outstanding question community-wide. Filtered in plain
// JS against the already-fetched array, same posture requirements.ts's
// own tag/flag checks take rather than a SQL array-contains clause.
//
// `options.cycleId`, when given, resolves per_cycle/phase questions
// against that event rather than the member's declared one — the
// read-side counterpart of submitAnswerInput.cycleId, and what lets
// /questions genuinely be "the questions for this event" when the
// declare-joining controls send someone straight there naming it.
// Unlike the write side this is a read, so an unknown/foreign/closed id
// degrades to "no event-scoped questions" rather than throwing; it only
// ever arrives from a query string on a page the member can already read.
export async function listOutstandingQuestions(
  actor: Member,
  options: { surface?: string; cycleId?: string | null } = {},
): Promise<OutstandingQuestion[]> {
  const allQuestions = await db
    .select()
    .from(profileQuestion)
    .where(and(eq(profileQuestion.communityId, actor.communityId), isNull(profileQuestion.archivedAt)));
  const questions = options.surface
    ? allQuestions.filter((q) => q.surfaces.includes(options.surface!))
    : allQuestions;

  // The member's own declared cycle (Phase 65) — not the nav's
  // view-scope switcher — so glancing at a different cycle never hides
  // a member's own real outstanding questions. See resolveCycleId
  // above for the identical reasoning on the write side.
  const declaredCycleId = options.cycleId
    ? await knownOpenCycleId(actor, options.cycleId)
    : await getMemberDeclaredCycleId(actor);
  const currentPhase = declaredCycleId ? await phaseForCycle(declaredCycleId) : null;

  const outstanding: OutstandingQuestion[] = [];
  for (const q of questions) {
    let cycleId: string | null = null;
    if (q.scope === "once_ever") {
      cycleId = null;
    } else if (q.scope === "per_cycle") {
      if (!declaredCycleId) continue;
      cycleId = declaredCycleId;
    } else {
      // phase
      if (!declaredCycleId || !currentPhase) continue;
      if (q.phaseNameHint?.toLowerCase() !== currentPhase.name.toLowerCase()) continue;
      // A phase that hasn't started yet is not a phase anyone should be
      // answering questions for. phaseForCycle (capacity.ts) returns the
      // earliest phase that *hasn't ended*, which deliberately ignores
      // start dates — correct for its "which phase drives the nav
      // highlight" job, wrong here: without this check, a community that
      // lays out its whole season up front would have every future
      // phase's questions counting against every member from day one,
      // including in the required-questions count behind the Dashboard
      // badge. "Availability — Build" is not anyone's problem in March
      // when Build is a summer away.
      if (currentPhase.startDate && new Date(currentPhase.startDate) > new Date()) continue;
      cycleId = declaredCycleId;
    }

    const [existing] = await db
      .select()
      .from(profileAnswer)
      .where(
        and(
          eq(profileAnswer.memberId, actor.id),
          eq(profileAnswer.questionId, q.id),
          cycleId ? eq(profileAnswer.cycleId, cycleId) : isNull(profileAnswer.cycleId),
        ),
      );

    // A `declined` row is normally NOT outstanding — a refusal is a
    // response, and re-listing the question would be exactly the nagging
    // "declined" exists to prevent. The one exception is a question that
    // no longer offers the option, where a stored decline is no longer a
    // choice the community ever offered and the question has to come
    // back. Mirrors how a deferral is kept outstanding regardless of
    // allowDeferral, with the required-count applying the flag.
    const isInvalidated =
      (existing?.status === "declined" && !q.allowPreferNotToSay) ||
      (existing?.status === "deferred" && !q.allowDeferral);

    if (!existing || existing.status === "deferred" || isInvalidated) {
      outstanding.push({ question: q, existingAnswer: existing ?? null });
    }
  }

  return outstanding;
}

// "Which required questions does this member still owe a real answer to"
// — the count behind the Dashboard badge, i.e. the forcing function for
// the one-click "I'm coming" that records participation without walking
// the member through that event's questions first. Declining to answer is
// allowed, so the three things that can make a required question stop
// counting are each deliberate rather than a loophole:
//
//  - a `deferred` answer ("I don't know yet") — ANSWERED, not
//    outstanding. profile_answer.ts's own schema comment says a deferred
//    status satisfies a required question without a guessed or fabricated
//    value, and nagging past an explicit "I don't know" would punish
//    exactly the honesty the defer button exists to allow. The question
//    still shows on /questions as answerable-later, since
//    listOutstandingQuestions above keeps deferred items outstanding for
//    that purpose. **But not once the question's `requiredBy` date has
//    passed** — see the note below.
//  - a `declined` answer ("prefer not to say") on a question that offers
//    one — answered, permanently. Someone making a choice about their own
//    information isn't a gap in the data, and no due date, nag or
//    escalation applies to them. Worth being explicit that this is what
//    makes `required` mean "everyone has responded" rather than
//    "everyone has a value" on those questions: a community that needs an
//    actual value from everyone simply doesn't offer the option.
//  - a stored `deferred` or `declined` answer on a question since marked
//    as offering neither (`allowDeferral: false` /
//    `allowPreferNotToSay: false`) — that state no longer exists for the
//    question, so the answer doesn't satisfy it and it counts again.
//  - a question that doesn't currently apply (a phase-scoped one whose
//    phase isn't current, or hasn't started yet) isn't outstanding, using
//    the same resolution listOutstandingQuestions above already does —
//    reusing that function rather than a fresh count is what keeps those
//    two answers from drifting apart.
//
// The `requiredBy` rule is the fix for the gap that made a plain
// required/deferred pair useless for planning data: "I don't know yet" is
// honest in March, but a community that needs a bed count to book
// transport needs a real number by a real date, and a deferral that
// never came back quietly lost that information forever. With no due
// date a deferral is permanent, which is right for a standing fact — the
// common case — and the whole point of the column being optional.
//
// Every surface here is unscoped: a required question is worth
// collecting whether or not its `surfaces` array names any flow, and
// whether or not the member is coming to anything at all.
export async function listOutstandingRequiredQuestions(actor: Member): Promise<OutstandingQuestion[]> {
  // Cheap first query so the (much more expensive) per-question answer
  // lookups below only run for communities that actually configured a
  // required question — the common case, and this runs on every request
  // via getNavContext.
  const [anyRequired] = await db
    .select({ id: profileQuestion.id })
    .from(profileQuestion)
    .where(
      and(
        eq(profileQuestion.communityId, actor.communityId),
        eq(profileQuestion.required, true),
        isNull(profileQuestion.archivedAt),
      ),
    );
  if (!anyRequired) return [];

  const now = new Date();
  const outstanding = await listOutstandingQuestions(actor);
  return outstanding.filter(({ question, existingAnswer }) => {
    if (!question.required) return false;
    // Never answered at all.
    if (!existingAnswer) return true;

    // A refusal is a real answer and the end of it — no due date, no nag,
    // no way to talk someone into it. (Only ever reached for a question
    // that has since withdrawn the option; listOutstandingQuestions
    // above keeps every other declined row off the list entirely.)
    if (existingAnswer.status === "declined") return true;

    // Same for a deferral on a question with no "not yet" (a date of
    // birth, a legal name): stored before the flag was switched off, so
    // not an answer the community ever solicited.
    if (existingAnswer.status === "deferred" && !question.allowDeferral) return true;

    if (existingAnswer.status !== "deferred") return false;
    // Deferred, but the date the community said it needed a real answer
    // by has now passed — back on the list. A deferral with no due date
    // stays satisfied forever, which is the point: "I don't know yet" is
    // the right answer for a standing emergency-contact question and the
    // wrong one for a bed count two weeks out.
    return Boolean(question.requiredBy && new Date(question.requiredBy) <= now);
  });
}

// Once-ever answers a member has already given — shown/editable
// directly on their profile, same as tags or contact methods (spec:
// "not something they have to hunt down a form to correct").
//
// `options.surface`, same narrowing listOutstandingQuestions above
// already offers, lets the Dashboard's onboarding panel ask for just
// the subset it cares about: once_ever questions tagged for onboarding
// that this member already has a real answer for — in practice, at
// first login, almost always seeded by a Form field's own
// mapsToProfileQuestionId at applicant→Member conversion (see
// src/lib/recruitment/decisions.ts) rather than anything the member
// typed into this platform directly. Shown as a compact, editable
// summary rather than re-asked from scratch — see
// src/app/(app)/dashboard/PrefilledAnswersReview.tsx.
// Changed mind about a decline, or want to revisit a deferral: the
// "Your answers" editor on /profile needs to surface those rows, not just
// the answered ones. It stays a "your standing facts" list either way —
// there's no separate declined/deferred list anywhere, because a declined
// or deferred question doesn't need chasing and /questions is where
// anything still open surfaces.
export async function listOnceEverAnswers(actor: Member, options: { surface?: string } = {}) {
  const conditions = [
    eq(profileQuestion.communityId, actor.communityId),
    eq(profileQuestion.scope, "once_ever"),
    isNull(profileQuestion.archivedAt),
  ];
  const questions = await db
    .select()
    .from(profileQuestion)
    .where(and(...conditions));
  const surfaced = options.surface ? questions.filter((q) => q.surfaces.includes(options.surface!)) : questions;

  const answers = await db
    .select()
    .from(profileAnswer)
    .where(and(eq(profileAnswer.memberId, actor.id), isNull(profileAnswer.cycleId)));
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

  // Includes deferred and declined rows, not just answered ones: this is
  // the member's own list of what they've already responded to, and
  // "I said I'd get back to this" / "I said I wouldn't say" are both
  // things they should be able to see and change their mind about. The
  // form's own Save button re-answers with a real value, which is how
  // either is revised.
  const answered = surfaced
    .filter((q) => answerByQuestion.has(q.id))
    .map((q) => ({ question: q, answer: answerByQuestion.get(q.id)! }));

  // Readability is resolved HERE rather than at each render site, so it
  // can't be forgotten: a permission that every consumer has to remember
  // to apply is one that eventually isn't, and the surface that forgets
  // is the one that leaks. `resolveReadableQuestions` fails closed, so a
  // sensitive answer the viewer may not read is simply absent from the
  // list rather than present-but-blurred — nothing in the delivered HTML
  // for someone who shouldn't see it to uncover.
  //
  // Inert while /profile is self-only (you can always read your own),
  // and already correct for the members view that's coming.
  const readable = await resolveReadableQuestions(
    actor,
    actor.id,
    answered.map(({ question, answer }) => ({
      questionId: question.id,
      sensitive: question.sensitive,
      shareWithAudience: answer.shareWithAudience,
    })),
  );
  return answered.filter(({ question }) => readable.has(question.id));
}
