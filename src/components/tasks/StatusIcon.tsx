// Icons come from phosphor's /dist/ssr entry — this renders inside
// Server Components, and the main entry's createContext breaks there.
import {
  CircleIcon,
  PlayCircleIcon,
  PauseCircleIcon,
  CheckCircleIcon,
  MegaphoneIcon,
} from "@phosphor-icons/react/dist/ssr";

// Task UI grammar (docs/design_handoff_conventions/README.md): one icon,
// two channels — shape = lifecycle status, color = attention level.
// Escalated overrides the shape (a manual coordinator push is a
// different kind of thing from automatic staleness).
//
// Only render this where tasks of MIXED status appear together
// (dashboard, contribution, coverage groups, search). On kanban the
// column already carries status — an icon there is noise, so TaskCard
// deliberately doesn't use this.
const SHAPE: Record<string, typeof CircleIcon> = {
  unclaimed: CircleIcon,
  claimed: PlayCircleIcon,
  waiting: PauseCircleIcon,
  done: CheckCircleIcon,
};

const COLOR: Record<string, string> = {
  ok: "text-[var(--text-muted)]",
  soft: "text-[var(--warning)]",
  hard: "text-[var(--danger)]",
  escalated: "text-[var(--danger)]",
};

const STATUS_LABEL: Record<string, string> = {
  unclaimed: "Unclaimed",
  claimed: "Claimed",
  waiting: "Waiting",
  done: "Done",
};

const ATTENTION_LABEL: Record<string, string> = {
  soft: "needs attention",
  hard: "stale",
  escalated: "escalated",
};

export default function StatusIcon({
  status,
  attentionLevel = "ok",
  size = 16,
  showLabel = false,
}: {
  status: string;
  attentionLevel?: string;
  size?: number;
  showLabel?: boolean;
}) {
  const escalated = attentionLevel === "escalated";
  const Icon = escalated ? MegaphoneIcon : (SHAPE[status] ?? CircleIcon);
  // Done tasks are a settled state — success green rather than the
  // neutral/accent treatment active statuses get.
  const color =
    status === "done" && attentionLevel === "ok"
      ? "text-[var(--success)]"
      : attentionLevel === "ok" && status === "claimed"
        ? "text-[var(--accent-1)]"
        : (COLOR[attentionLevel] ?? COLOR.ok);
  const label = escalated
    ? "Escalated"
    : `${STATUS_LABEL[status] ?? status}${ATTENTION_LABEL[attentionLevel] ? ` — ${ATTENTION_LABEL[attentionLevel]}` : ""}`;

  return (
    <span className={`inline-flex items-center gap-1 ${color}`} title={label} aria-label={label} role="img">
      <Icon size={size} weight={escalated ? "fill" : "regular"} />
      {showLabel && <span className="text-[12px]">{label}</span>}
    </span>
  );
}
