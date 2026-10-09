"use client";

import { useState } from "react";
import {
  DECLARATION_LABELS,
  declarationFromMarks,
  describeLanePath,
  laneHandles,
  laneRoute,
  type AdmissionLaneRule,
} from "@/lib/recruitment/lane-rules";
import { INPUT, LABEL } from "@/components/ui/kit";

// "The knowing/good-fit marks are shown with their consequences" (§5.3 of the
// earlier plan, carried into docs/admission-flow.md §2a).
//
// The two checkboxes used to be bare labels with their effect explained in a
// paragraph further down the form, about capacity holds. That is the wrong
// order: the person about to tick a box wants to know what ticking it does *to
// their friend*, and they want to know before they commit. So the consequence
// is derived live from the marks plus the community's own lanes, using the same
// function the settings panel and the applicant's own page use. One source of
// truth for "what actually happens" is the whole point: the inviter, the admin
// writing the lanes, and the person joining all read the same sentence about
// the same configuration.
//
// The event is chosen here too, not beside it, because which lane an invite
// takes depends on which lanes the event has opened (§2a: an event chooses its
// own set), so the answer has to change as the event does.
export type InviteContext = {
  /** "" for a general community invite, otherwise the event's id. */
  id: string;
  label: string;
  lanes: AdmissionLaneRule[];
};

export default function InviteMarkPicker({
  contexts,
  communityName,
}: {
  contexts: InviteContext[];
  communityName: string;
}) {
  const [knowsPersonally, setKnowsPersonally] = useState(false);
  const [thinksGoodFit, setThinksGoodFit] = useState(false);
  const [contextId, setContextId] = useState("");

  // Both marks count as knowing them personally, because it's the stronger
  // signal and a fourth lane for "ticked both" would only make the weaker mark
  // mean something different depending on what else was ticked.
  const declaration = declarationFromMarks({
    inviterKnowsPersonally: knowsPersonally,
    inviterThinksGoodFit: thinksGoodFit,
  });
  const context = contexts.find((c) => c.id === contextId) ?? contexts[0];
  const lane = context.lanes.find((l) => laneHandles(l, declaration)) ?? null;
  const isCheck = lane ? laneRoute(lane) === "check" : false;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
        What do you know about this person?
      </p>

      <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
        <input
          type="checkbox"
          name="inviterKnowsPersonally"
          checked={knowsPersonally}
          onChange={(e) => setKnowsPersonally(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I personally know this person
          <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
            A real relationship, not a judgement. This is the stronger of the two marks, and ticking
            both is read as this one.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
        <input
          type="checkbox"
          name="inviterThinksGoodFit"
          checked={thinksGoodFit}
          onChange={(e) => setThinksGoodFit(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I think this person is a good fit
          <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
            Not a relationship — a judgement. Perfectly good on its own. Whichever you tick, the
            people who evaluate them are shown it.
          </span>
        </span>
      </label>

      {contexts.length > 1 && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>For an event (optional — off = a general community invite)</span>
          <select name="cycleId" className={INPUT} value={contextId} onChange={(e) => setContextId(e.target.value)}>
            {contexts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id === "" ? "— general invite —" : c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div
        className="mt-1 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
        style={{ background: "var(--neutral-100)" }}
      >
        {lane ? (
          <>
            <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">{lane.name}</p>
            <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">
              <span className="text-[var(--text-muted)]">They go through: </span>
              {describeLanePath(lane)}
            </p>
          </>
        ) : (
          <p className="text-[length:var(--text-body)] text-[var(--text)]">
            {contextId === "" ? "This community isn't" : "This event isn't"} taking invitations from someone who{" "}
            {DECLARATION_LABELS[declaration]} right now, so there&rsquo;s nothing to send for that.
          </p>
        )}
      </div>

      {isCheck && (
        // The awareness tick, and it is mandatory: the lib refuses the invite
        // without it, because a lane whose whole legitimacy is consent cannot
        // be used by somebody who didn't tell the person. Better to stop the
        // inviter here than to discover at redemption that the link exists and
        // nobody's ready for it.
        <label
          className="mt-1 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--warning-border)] p-3 text-[length:var(--text-body)] text-[var(--text)]"
          style={{ background: "var(--warning-soft)" }}
        >
          <input type="checkbox" name="awarenessConfirmed" required className="mt-0.5" />
          <span>
            I&rsquo;ve told them that joining means their arrival is announced to {communityName}, and
            that any member can raise a concern in the days after
            <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
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
