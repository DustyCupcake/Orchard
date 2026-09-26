import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assembly, assemblyQuestion, assemblyResponse } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { computeAssemblyPhase, type AssemblyPhase } from "./phase";
import { ASSEMBLY_TEMPLATE_KEYS, templateItemsFor } from "./founding-settings";

type Member = typeof memberTable.$inferSelect;

// "The proposer ... picks durations that fit what's being decided,
// down to compressing agenda and notice to nearly nothing for
// something genuinely time-sensitive" — agenda/notice can be zero,
// voting can't (there'd be nothing left to actually vote during).
//
// templateKey names the built-in shape this Assembly starts from (null
// = written from scratch); when it's set, createAssembly seeds that
// shape's agenda in the same transaction, so every path that can
// create a template Assembly — the /assemblies/new form, the JSON API
// — gets a properly seeded one and there's no way to end up with an
// empty Assembly that still claims to be the Founding settings shape.
export const createAssemblyInput = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  agendaMinutes: z.number().int().min(0),
  noticeMinutes: z.number().int().min(0),
  votingMinutes: z.number().int().min(1),
  templateKey: z.enum(ASSEMBLY_TEMPLATE_KEYS).optional(),
});
export type CreateAssemblyInput = z.infer<typeof createAssemblyInput>;

// "Any member can propose an Assembly, same open-access principle as
// everywhere else — no gatekeeping on who's allowed to call for one."
export async function createAssembly(actor: Member, input: CreateAssemblyInput) {
  const now = new Date();
  const agendaEndsAt = new Date(now.getTime() + input.agendaMinutes * 60_000);
  const noticeEndsAt = new Date(agendaEndsAt.getTime() + input.noticeMinutes * 60_000);
  const votingEndsAt = new Date(noticeEndsAt.getTime() + input.votingMinutes * 60_000);

  // A template's items ARE the starting agenda, so they're inserted
  // directly rather than through addAgendaItem: they're part of
  // creating the thing, not a member adding to an already-open agenda,
  // and addAgendaItem's phase gate would reject them outright on the
  // urgent/zero-minute shape — where the seeded items are the entire
  // agenda and there's nothing to add to. One bulk insert instead of
  // one round trip per item, inside the same transaction as the
  // Assembly row itself.
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(assembly)
      .values({
        communityId: actor.communityId,
        title: input.title,
        description: input.description ?? "",
        proposedBy: actor.id,
        agendaEndsAt,
        noticeEndsAt,
        votingEndsAt,
        templateKey: input.templateKey ?? null,
      })
      .returning();

    if (input.templateKey) {
      await tx.insert(assemblyQuestion).values(
        templateItemsFor(input.templateKey).map((item) => ({
          assemblyId: created.id,
          addedBy: actor.id,
          text: item.text,
          responseType: item.responseType,
          options: item.options,
          settingsMapping: item.settingsMapping,
        })),
      );
    }

    return created;
  });
}

export async function listAssemblies(actor: Member) {
  const rows = await db
    .select()
    .from(assembly)
    .where(eq(assembly.communityId, actor.communityId))
    .orderBy(desc(assembly.createdAt));

  // Participation counts, so the list can say what state each Assembly is
  // actually in rather than only its phase — "did I vote" is the whole
  // reason a member reopens this page, and the old list couldn't answer
  // it.
  const countsByAssembly = await assemblyParticipationById(actor, rows.map((r) => r.id));

  return rows.map((a) => {
    const counts = countsByAssembly.get(a.id) ?? { questions: 0, responses: 0, mine: 0 };
    return {
      ...a,
      phase: computeAssemblyPhase(a),
      questionCount: counts.questions,
      responseCount: counts.responses,
      myResponseCount: counts.mine,
      needsMyAnswer: isAwaitingMyAnswer({
        phase: computeAssemblyPhase(a),
        questionCount: counts.questions,
        myResponseCount: counts.mine,
      }),
    };
  });
}

/**
 * Does this Assembly still owe this member an answer?
 *
 * One definition, read by the /assemblies list ("Waiting on you"), the
 * /community hub's open-Assemblies section, and the Community nav
 * badge — three surfaces that must never disagree about whether
 * something is outstanding.
 *
 * Only the **voting** phase counts, and that restriction is the whole
 * design. An Assembly is not urgent by default (docs/spec.md: "No
 * built-in urgent notification, on purpose"), so a badge that lit up
 * for every open Assembly would recreate exactly the nag the spec
 * avoided and would be ignored within a week. The existing badges count
 * *obligations* — things waiting on you — and this one does the same:
 *
 *  - **agenda** isn't an obligation. Anyone may add an item; there is
 *    no approval step and no way anyone is waiting on anyone.
 *  - **notice** isn't actionable yet. That phase exists so the agenda
 *    can be *read*, and counting it would nag people for voting on
 *    something they haven't been allowed to vote on.
 *  - **voting** is the one where a member has been asked a question and
 *    can still answer it.
 *  - **closed** is done.
 */
export function isAwaitingMyAnswer(a: {
  phase: AssemblyPhase;
  questionCount: number;
  myResponseCount: number;
}): boolean {
  return a.phase === "voting" && a.questionCount > 0 && a.myResponseCount < a.questionCount;
}

/**
 * Question / response / my-response counts per Assembly, in one query.
 *
 * `mine` is folded into the same grouped query as the totals via a
 * member-scoped left join rather than a second round trip per
 * Assembly, which is what keeps the nav badge affordable on a path
 * that runs on every authenticated request (getNavContext).
 */
export async function assemblyParticipationById(
  actor: Member,
  assemblyIds: string[],
): Promise<Map<string, { questions: number; responses: number; mine: number }>> {
  const result = new Map<string, { questions: number; responses: number; mine: number }>();
  if (assemblyIds.length === 0) return result;

  const rows = await db
    .select({
      assemblyId: assemblyQuestion.assemblyId,
      questions: sql<number>`count(distinct ${assemblyQuestion.id})`.mapWith(Number),
      responses: sql<number>`count(distinct ${assemblyResponse.id})`.mapWith(Number),
      // Counts only this member's responses: the join is constrained, so
      // the aggregate is a per-member count without a second query.
      mine: sql<number>`count(distinct ${assemblyResponse.id}) filter (where ${assemblyResponse.memberId} = ${actor.id})`.mapWith(
        Number,
      ),
    })
    .from(assemblyQuestion)
    .leftJoin(assemblyResponse, eq(assemblyResponse.assemblyQuestionId, assemblyQuestion.id))
    .where(inArray(assemblyQuestion.assemblyId, assemblyIds))
    .groupBy(assemblyQuestion.assemblyId);

  for (const row of rows) {
    result.set(row.assemblyId, {
      questions: row.questions,
      responses: row.responses,
      mine: row.mine,
    });
  }
  return result;
}

/**
 * Open Assemblies, with this member's standing on each.
 *
 * Backs both the /community hub's listing and the Community nav badge,
 * so the badge is literally a count of what that page shows rather than
 * a second thing to keep in step.
 *
 * `closed` Assemblies are excluded at the SQL level (a vote that ended
 * can never be one you still owe an answer to) but the *phase* of
 * everything else is computed by the shared computeAssemblyPhase rather
 * than by a hand-written timestamp comparison, so this can't drift from
 * the lifecycle every other surface reads.
 */
export async function listOpenAssemblies(actor: Member) {
  const rows = await db
    .select()
    .from(assembly)
    .where(
      and(
        eq(assembly.communityId, actor.communityId),
        // voting_ends_at is the last boundary, so "not yet closed" is
        // exactly this comparison — a cheaper prefilter than computing
        // the phase and discarding it.
        gt(assembly.votingEndsAt, new Date()),
      ),
    )
    .orderBy(desc(assembly.createdAt));

  const counts = await assemblyParticipationById(actor, rows.map((r) => r.id));
  return rows.map((a) => {
    const phase = computeAssemblyPhase(a);
    const c = counts.get(a.id) ?? { questions: 0, responses: 0, mine: 0 };
    return {
      ...a,
      phase,
      questionCount: c.questions,
      responseCount: c.responses,
      myResponseCount: c.mine,
      needsMyAnswer: isAwaitingMyAnswer({ phase, questionCount: c.questions, myResponseCount: c.mine }),
    };
  });
}

export async function requireAssemblyInCommunity(actor: Member, assemblyId: string) {
  const [row] = await db
    .select()
    .from(assembly)
    .where(and(eq(assembly.id, assemblyId), eq(assembly.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Assembly not found");
  }
  return row;
}

// The full detail view: the Assembly, its agenda items, and — for
// each item — every response so far ("results are always advisory,
// never auto-applied", but they're not hidden either; same default-
// open visibility Input rounds already uses for its live tallies) plus
// this member's own response, for pre-filling the vote form.
export async function getAssembly(actor: Member, assemblyId: string) {
  const a = await requireAssemblyInCommunity(actor, assemblyId);

  const questions = await db
    .select()
    .from(assemblyQuestion)
    .where(eq(assemblyQuestion.assemblyId, assemblyId))
    .orderBy(assemblyQuestion.createdAt);

  const responses =
    questions.length === 0
      ? []
      : await db
          .select()
          .from(assemblyResponse)
          .where(
            inArray(
              assemblyResponse.assemblyQuestionId,
              questions.map((q) => q.id),
            ),
          );
  const responsesByQuestion = new Map<string, (typeof assemblyResponse.$inferSelect)[]>();
  for (const r of responses) {
    const list = responsesByQuestion.get(r.assemblyQuestionId) ?? [];
    list.push(r);
    responsesByQuestion.set(r.assemblyQuestionId, list);
  }

  return {
    ...a,
    phase: computeAssemblyPhase(a),
    questions: questions.map((q) => {
      const qResponses = responsesByQuestion.get(q.id) ?? [];
      return {
        ...q,
        responses: qResponses,
        myResponse: qResponses.find((r) => r.memberId === actor.id) ?? null,
      };
    }),
  };
}
