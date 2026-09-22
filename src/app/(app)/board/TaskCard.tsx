import Link from "next/link";
import { FlameIcon } from "@phosphor-icons/react/dist/ssr";
import type { requirement as requirementTable } from "@/db/schema";
import { describeRequirement } from "@/lib/tasks";
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
import { Tag, ATTENTION_TONE, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from "@/components/ui/kit";
import ActionMenu from "@/components/ui/ActionMenu";
import { BranchChip, CapacityChip, DateChip, EffortChip } from "@/components/tasks/MetaChips";
import {
  claimAction,
  escalateTaskAction,
  finishAction,
  finishWaitingAction,
  parkAction,
  releaseAction,
  resumeAction,
  withdrawRequestAction,
} from "./actions";

const ATTENTION_BORDER_VAR: Record<string, string> = {
  soft: "var(--warning)",
  hard: "var(--danger)",
  escalated: "var(--danger)",
};

type Assignment = { taskId: string; memberId: string; memberName: string; isShadow: boolean };
type Requirement = typeof requirementTable.$inferSelect;
type Task = {
  id: string;
  title: string;
  description: string;
  status: string;
  capacity: number | null;
  openness: string;
  effort: string;
  effortMagnitude: unknown;
  nextCheckinAt: Date | null;
  waitingNote: string | null;
  critical: boolean;
  attentionLevel: string;
  cycleId: string | null;
};

// Task UI grammar (docs/design_handoff_conventions/README.md):
// - No status icon here — kanban columns / phase groups / coverage
//   groups already carry status; an icon would be noise.
// - One primary action per state, everything else in the ⋯ menu.
// - Requirements summarize: unmet individual gates listed, the rest
//   collapse to "N of M met"; soft_priority is detail-page-only.
export default function TaskCard({
  task,
  assignments,
  requirements,
  unmetRequirements,
  groupCoverage,
  tierNames,
  branchName,
  currentMemberId,
  myPendingRequestId,
  isCoordinationHolderForBranch,
}: {
  task: Task;
  assignments: Assignment[];
  requirements: Requirement[];
  unmetRequirements: Requirement[];
  groupCoverage: Map<string, boolean>;
  tierNames: Map<string, string>;
  branchName: string;
  currentMemberId: string;
  myPendingRequestId: string | null;
  isCoordinationHolderForBranch: boolean;
}) {
  // A shadow isn't a real holder — doesn't count toward capacity, isn't
  // who "Held by" means — see docs/spec.md's "Shadow slots & succession"
  // and lifecycle.ts's assignmentCount(), which excludes them the same way.
  const realAssignments = assignments.filter((a) => !a.isShadow);
  const shadowAssignments = assignments.filter((a) => a.isShadow);
  const holds = realAssignments.some((a) => a.memberId === currentMemberId);
  const shadowing = shadowAssignments.some((a) => a.memberId === currentMemberId);
  const hasRoom = task.capacity === null || realAssignments.length < task.capacity;
  const unmetIds = new Set(unmetRequirements.map((r) => r.id));
  const eligible = unmetRequirements.length === 0;

  const requestGated = task.openness === "request" || task.openness === "coordination_approved";
  const joiningRequiresRequest =
    task.status === "claimed" && realAssignments.length > 0 && requestGated;
  const isCommunityEndorsed = task.openness === "community_endorsed";

  const needsSelfAssignConfirmation =
    isCoordinationHolderForBranch && (task.status === "unclaimed" || task.attentionLevel !== "ok");

  const canAct =
    !isCommunityEndorsed &&
    !shadowing &&
    !needsSelfAssignConfirmation &&
    (task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) &&
    eligible &&
    !myPendingRequestId;
  const canClaim = canAct && !joiningRequiresRequest;
  const canRequest = canAct && joiningRequiresRequest;
  const needsConfirmationLink =
    !isCommunityEndorsed &&
    !shadowing &&
    needsSelfAssignConfirmation &&
    (task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) &&
    eligible &&
    !myPendingRequestId;
  const blockedByRequirements =
    !isCommunityEndorsed &&
    !shadowing &&
    (task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) &&
    !eligible &&
    !myPendingRequestId;
  const canShadow = !holds && !shadowing && (task.status === "claimed" || task.status === "waiting");
  const attention = ATTENTION_STYLES[task.attentionLevel];

  // Requirements summarization — individual_gate: unmet listed, met
  // counted; group_coverage: one standing status line each;
  // soft_priority: hidden on cards (detail page only).
  const gateReqs = requirements.filter((r) => r.mode === "individual_gate");
  const unmetGateReqs = gateReqs.filter((r) => unmetIds.has(r.id));
  const metGateCount = gateReqs.length - unmetGateReqs.length;
  const coverageReqs = requirements.filter((r) => r.mode === "group_coverage");

  // ── Action wiring (one primary + menu, per the grammar table) ──
  const escalateForm = isCoordinationHolderForBranch && task.attentionLevel !== "escalated" && (
    <form action={escalateTaskAction}>
      <input type="hidden" name="taskId" value={task.id} />
      <button type="submit">Escalate</button>
    </form>
  );
  const releaseForm = (
    <form action={releaseAction}>
      <input type="hidden" name="taskId" value={task.id} />
      <button type="submit">Release</button>
    </form>
  );
  const shadowLink = canShadow && <Link href={`/tasks/${task.id}`}>Shadow this task</Link>;

  let primaryAction: React.ReactNode = null;
  let secondaryAction: React.ReactNode = null;
  const menuItems: React.ReactNode[] = [];

  if ((canClaim || canRequest) && !holds) {
    primaryAction = (
      <form action={claimAction}>
        <input type="hidden" name="taskId" value={task.id} />
        <button type="submit" className={BUTTON_PRIMARY}>
          {canRequest ? "Request to join" : "Claim"}
        </button>
      </form>
    );
    if (shadowLink) menuItems.push(shadowLink);
    if (escalateForm) menuItems.push(escalateForm);
  } else if (task.status === "claimed" && holds) {
    primaryAction = (
      <form action={finishAction}>
        <input type="hidden" name="taskId" value={task.id} />
        <button type="submit" className={BUTTON_PRIMARY}>
          Finish
        </button>
      </form>
    );
    // Park needs inputs (date + note), so it's a disclosure, not a menu row.
    secondaryAction = (
      <details className="w-full">
        <summary className="inline-flex cursor-pointer items-center text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
          Park until a check-in date…
        </summary>
        <form action={parkAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="date" name="nextCheckinAt" required className={`${INPUT} min-w-0`} />
          <input
            type="text"
            name="waitingNote"
            placeholder="waiting on…"
            className={`${INPUT} min-w-0 flex-1 basis-32`}
          />
          <button type="submit" className={BUTTON_SECONDARY}>
            Park
          </button>
        </form>
      </details>
    );
    menuItems.push(releaseForm);
    if (escalateForm) menuItems.push(escalateForm);
  } else if (task.status === "waiting" && holds) {
    primaryAction = (
      <form action={resumeAction}>
        <input type="hidden" name="taskId" value={task.id} />
        <button type="submit" className={BUTTON_PRIMARY}>
          Resume
        </button>
      </form>
    );
    menuItems.push(
      <form action={finishWaitingAction}>
        <input type="hidden" name="taskId" value={task.id} />
        <button type="submit">Mark done</button>
      </form>,
      <Link href={`/tasks/${task.id}`}>Re-snooze…</Link>,
      releaseForm,
    );
    if (escalateForm) menuItems.push(escalateForm);
  } else if (shadowing) {
    secondaryAction = (
      <form action={releaseAction}>
        <input type="hidden" name="taskId" value={task.id} />
        <button type="submit" className={BUTTON_SECONDARY}>
          Stop shadowing
        </button>
      </form>
    );
    if (escalateForm) menuItems.push(escalateForm);
  } else {
    // Not actionable for this viewer (endorsed flow, blocked, pending,
    // or just someone else's task) — links/menu only.
    if (shadowLink) menuItems.push(shadowLink);
    if (escalateForm) menuItems.push(escalateForm);
  }

  return (
    <div
      className="mb-3 rounded-[var(--radius-md)] border p-3"
      style={{
        borderColor: "var(--border)",
        borderLeft: `3px solid ${attention ? ATTENTION_BORDER_VAR[task.attentionLevel] : "var(--border)"}`,
        background: task.critical ? "var(--danger-soft)" : "var(--surface)",
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {task.critical && (
          <span className="text-[var(--danger)]" title="Critical" aria-label="Critical" role="img">
            <FlameIcon size={14} weight="fill" />
          </span>
        )}
        <Link href={`/tasks/${task.id}`} className="text-[14px] font-semibold text-[var(--text)] hover:text-[var(--accent-1)]">
          {task.title}
        </Link>
        {attention && <Tag tone={ATTENTION_TONE[task.attentionLevel] ?? "neutral"}>{attention.label}</Tag>}
        {task.cycleId === null && <Tag>not cycle-scoped</Tag>}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <BranchChip name={branchName} />
        <EffortChip summary={effortSummary(task.effort, task.effortMagnitude)} />
        <CapacityChip held={realAssignments.length} capacity={task.capacity} />
      </div>

      {task.description && (
        <p className="mt-1.5 line-clamp-2 text-[13px] text-[var(--text)]">{task.description}</p>
      )}

      {realAssignments.length > 0 && (
        <p className="mt-1.5 text-[12px] text-[var(--text)]">
          Held by: {realAssignments.map((a) => a.memberName).join(", ")}
        </p>
      )}
      {shadowAssignments.length > 0 && (
        <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
          Shadowed by: {shadowAssignments.map((a) => a.memberName).join(", ")}
        </p>
      )}
      {task.status === "waiting" && (
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text)]">
          <DateChip date={task.nextCheckinAt ?? "—"} label="Check-in" />
          {task.waitingNote && <span className="text-[var(--text-muted)]">— {task.waitingNote}</span>}
        </p>
      )}

      {(unmetGateReqs.length > 0 || metGateCount > 0 || coverageReqs.length > 0) && (
        <ul className="my-1.5 flex flex-col gap-0.5 text-[12px]">
          {unmetGateReqs.map((r) => (
            <li key={r.id} className="text-[var(--danger)]">
              {describeRequirement(r, tierNames)} (not met)
            </li>
          ))}
          {gateReqs.length > 0 && unmetGateReqs.length === 0 && (
            <li className="text-[var(--success)]">
              {metGateCount} of {gateReqs.length} requirement{gateReqs.length !== 1 ? "s" : ""} met
            </li>
          )}
          {gateReqs.length > 0 && unmetGateReqs.length > 0 && metGateCount > 0 && (
            <li className="text-[var(--text-muted)]">
              {metGateCount} of {gateReqs.length} met
            </li>
          )}
          {coverageReqs.map((r) => {
            const covered = groupCoverage.get(r.id) ?? false;
            return (
              <li key={r.id} className={covered ? "text-[var(--success)]" : "text-[var(--warning)]"}>
                {describeRequirement(r, tierNames)} — {covered ? "covered" : "not yet covered"}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {primaryAction}
        {secondaryAction}

        {myPendingRequestId && (
          <>
            <span className="text-[12px] text-[var(--text-muted)]">Request pending</span>
            <form action={withdrawRequestAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="requestId" value={myPendingRequestId} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Withdraw
              </button>
            </form>
          </>
        )}
        {blockedByRequirements && (
          <span className="text-[12px] text-[var(--danger)]">Not eligible — see unmet requirements</span>
        )}
        {needsConfirmationLink && (
          <Link href={`/tasks/${task.id}`} className="text-[12px] font-medium text-[var(--accent-1)] hover:underline">
            {joiningRequiresRequest ? "Request to join" : "Claim"} (confirm on task page) →
          </Link>
        )}
        {isCommunityEndorsed && !holds && (
          <Link href={`/tasks/${task.id}`} className="text-[12px] font-medium text-[var(--accent-1)] hover:underline">
            Put yourself forward or endorse a candidate →
          </Link>
        )}
        {shadowing && <span className="text-[12px] text-[var(--text-muted)]">Shadowing</span>}

        {menuItems.length > 0 && (
          <span className="ml-auto">
            <ActionMenu>{menuItems.map((item, i) => <span key={i}>{item}</span>)}</ActionMenu>
          </span>
        )}
      </div>
    </div>
  );
}
