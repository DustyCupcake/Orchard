"use client";

import { useState } from "react";
import {
  describeLaneConsequence,
  JOINING_LANE_COPY,
  joiningLaneForInvite,
  redemptionPathForRule,
  summarizeLaneRule,
  type JoiningLaneRule,
} from "@/lib/recruitment/lanes";

// §5.3's "the knowing/good-fit marks are shown with their consequences".
//
// The two checkboxes used to be bare labels with their effect explained
// in a paragraph further down the form, about capacity holds. That is the
// wrong order: the person about to tick a box wants to know what ticking
// it does *to their friend*, and they want to know before they commit.
//
// So the consequence is derived live from the marks plus the community's
// own rule for the resulting lane, using the same two functions the
// settings panel and the applicant's own page use. One source of truth
// for "what actually happens" is the whole point: the inviter, the admin
// writing the rule, and the person joining all read the same sentence
// about the same configuration.
export default function InviteMarkPicker({
  laneRules,
  communityName,
}: {
  laneRules: Record<"invited_knows_personally" | "invited_good_fit" | "invited_neither", JoiningLaneRule>;
  communityName: string;
}) {
  const [knowsPersonally, setKnowsPersonally] = useState(false);
  const [thinksGoodFit, setThinksGoodFit] = useState(false);

  // J4 — both marks count as knows-personally, because it's the stronger
  // signal and a fourth lane for "ticked both" would only make the
  // weaker mark mean something different depending on what else was
  // ticked.
  const lane = joiningLaneForInvite({
    inviterKnowsPersonally: knowsPersonally,
    inviterThinksGoodFit: thinksGoodFit,
  });
  // The public lane can't be reached from an invite, and a mark picker
  // has no public-lane rule to show, so the three invite rules are
  // narrowed to the keys this can actually land on.
  const rule = laneRules[lane as keyof typeof laneRules];
  const path = redemptionPathForRule(rule);
  const isConsensus = rule.verificationMode === "consensus";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-medium text-[var(--text-muted)]">
        What do you know about this person?
      </p>

      <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
        <input
          type="checkbox"
          name="inviterKnowsPersonally"
          checked={knowsPersonally}
          onChange={(e) => setKnowsPersonally(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I personally know this person
          <span className="block text-[12px] text-[var(--text-muted)]">
            A real relationship, not a judgement. This is the stronger of the two marks, and ticking
            both is read as this one.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
        <input
          type="checkbox"
          name="inviterThinksGoodFit"
          checked={thinksGoodFit}
          onChange={(e) => setThinksGoodFit(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I think this person is a good fit
          <span className="block text-[12px] text-[var(--text-muted)]">
            Not a relationship — a judgement. Perfectly good on its own; it just asks something
            different of the community.
          </span>
        </span>
      </label>

      <div
        className="mt-1 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
        style={{ background: "var(--neutral-100)" }}
      >
        <p className="text-[12px] font-medium text-[var(--text-muted)]">
          {JOINING_LANE_COPY[lane].title} — {summarizeLaneRule(rule)}
        </p>
        <p className="mt-1 text-[13px] text-[var(--text)]">
          <span className="text-[var(--text-muted)]">They </span>
          {lowerFirst(describeLaneConsequence(rule))}
        </p>
        {path === "nomination" && (
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">
            You&rsquo;ll get a support link straight after you create this, so you can pass it on or
            ask specific people directly.
          </p>
        )}
      </div>

      {isConsensus && (
        // J10's awareness tick, and it is mandatory: the lib refuses the
        // invite without it, because a consensus lane whose whole
        // legitimacy is consent cannot be used by somebody who didn't
        // tell the person. Better to stop the inviter here than to
        // discover at redemption that the link exists and nobody's ready
        // for it.
        <label className="mt-1 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--warning-border)] p-3 text-[13px] text-[var(--text)]" style={{ background: "var(--warning-soft)" }}>
          <input type="checkbox" name="awarenessConfirmed" required className="mt-0.5" />
          <span>
            I&rsquo;ve told them that joining means their arrival is announced to {communityName}, and
            that any member can raise a concern in the days after
            <span className="block text-[12px] text-[var(--text-muted)]">
              This is awareness, not consent — they&rsquo;ll be asked to agree for themselves at the
              other end. But an invite that goes out without this has broken the deal the lane makes,
              so it can&rsquo;t be sent.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
