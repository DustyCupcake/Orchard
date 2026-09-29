import Link from "next/link";
import {
  describeChange,
  type SettingsChangeRow,
} from "@/lib/settings/history";

// The log is a record, not a control surface, so this tab uses neither
// SettingsCard nor SettingsGroup. Cards are for things you add more of
// (questions, branches, tiers, forms) and groups are for sets of controls
// you open in order to edit — and a log row is neither. It wants the
// plainest thing available: a heading, a list, and a filter.

// A log row names the thing that changed, in the reader's vocabulary, not
// the schema's. `profile_question` is greppable in the database; in front
// of a member it is just a question.
const ENTITY_LABEL: Record<string, string> = {
  community: "Community settings",
  branch: "Branches",
  tier: "Tiers",
  cycle_type: "Event types",
  trait_axis: "Trait axes",
  form: "Forms",
  profile_question: "Questions",
  consent_purpose: "Consent purposes",
  sensitive_field_rule: "Who can see what",
  permission_grant: "Access & permissions",
  open_permission_grant: "Modules",
  bulk_member_import: "Member import",
};

const ENTITY_ORDER = [
  "community",
  "branch",
  "tier",
  "cycle_type",
  "trait_axis",
  "form",
  "profile_question",
  "consent_purpose",
  "sensitive_field_rule",
  "permission_grant",
  "open_permission_grant",
  "bulk_member_import",
];

/** The entity a row belongs to, as the reader sees it. `entityLabel` is
 *  the *thing's* name ("Fruit salad") where there is one; for the community
 *  row and open_permission_grant there is no such thing, which is what the
 *  second argument is for. */
function subject(row: SettingsChangeRow): string {
  if (row.entityLabel) return row.entityLabel;
  if (row.entity === "community") return "this community";
  return ENTITY_LABEL[row.entity] ?? row.entity;
}

function when(date: Date): string {
  // A relative time alone goes vague quickly ("3 months ago" is fine, "8
  // months ago" is not), so anything past a fortnight gets the date too.
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Group rows back into the saves that produced them.
 *
 * Every field of one save shares a `changedAt`, because the rows are
 * inserted in a single statement and `defaultNow()` is
 * `transaction_timestamp()` — so the timestamp genuinely is the
 * transaction, which makes it a better grouping key than anything derived.
 * The actor is part of the key because a community-wide feed is otherwise
 * liable to show two different people's saves as one event.
 */
function groupBySave(rows: SettingsChangeRow[]) {
  const groups: { at: Date; actorName: string; rows: SettingsChangeRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.at.getTime() === row.changedAt.getTime() && last.actorName === row.actorName) {
      last.rows.push(row);
    } else {
      groups.push({ at: row.changedAt, actorName: row.actorName, rows: [row] });
    }
  }
  return groups;
}

function FilterRow({
  counts,
  active,
}: {
  counts: Record<string, number>;
  active: string | null;
}) {
  const present = ENTITY_ORDER.filter((e) => (counts[e] ?? 0) > 0);
  if (present.length === 0) return null;
  const total = present.reduce((n, e) => n + counts[e], 0);
  const chip = (key: string | null, label: string, count: number) => (
    <Link
      href={key ? `/settings?tab=history&entity=${key}` : "/settings?tab=history"}
      className={
        active === key || (key === null && active === null)
          ? "rounded-[var(--radius-sm)] border border-[var(--accent-1)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--text)]"
          : "rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
      }
    >
      {label} <span className="text-[var(--text-muted)]">{count}</span>
    </Link>
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {chip(null, "Everything", total)}
      {present.map((e) => chip(e, ENTITY_LABEL[e], counts[e]))}
    </div>
  );
}

export default function HistoryTab({
  rows,
  counts,
  activeEntity,
}: {
  rows: SettingsChangeRow[];
  counts: Record<string, number>;
  activeEntity: string | null;
}) {
  const groups = groupBySave(rows);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[22px] font-semibold text-[var(--text)]">Change log</h2>
        <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-[var(--text-muted)]">
          Every change to a setting, one line per field, newest first. Old and new values both
          kept, so it also answers what a setting was before.
        </p>
      </div>

      <FilterRow counts={counts} active={activeEntity} />

      {groups.length === 0 ? (
        <p className="text-[13px] text-[var(--text-muted)]">
          {activeEntity
            ? `Nothing has changed ${ENTITY_LABEL[activeEntity]?.toLowerCase() ?? activeEntity} yet.`
            : "Nothing has been logged yet."}
        </p>
      ) : (
        <ol className="flex flex-col">
          {groups.map((g) => (
            <li key={g.rows[0].id} className="border-t border-[var(--border)] py-3 first:border-t-0">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text)]">{g.actorName}</span>
                <span>
                  changed {g.rows.length === 1 ? "one setting" : `${g.rows.length} settings`}
                </span>
                <span aria-hidden>·</span>
                <time dateTime={g.at.toISOString()}>{when(g.at)}</time>
              </div>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {g.rows.map((r) => {
                  // The kind is a prefix only when the row also names a
                  // thing. For the community row and for a module toggle
                  // there is no separate subject, and "Community settings:
                  // whether interviews are open" is a prefix that leads
                  // nowhere — the sentence already stands on its own.
                  const kind = ENTITY_LABEL[r.entity];
                  return (
                    <li key={r.id} className="text-[13px] leading-relaxed text-[var(--text)]">
                      {r.entity === "community" ? null : (
                        <span className="text-[var(--text-muted)]">{r.entityLabel ? `${kind}: ` : `${kind} — `}</span>
                      )}
                      {r.entity !== "community" && r.entityLabel ? (
                        <span className="text-[var(--text-muted)]">{subject(r)} — </span>
                      ) : null}
                      {describeChange(r)}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
