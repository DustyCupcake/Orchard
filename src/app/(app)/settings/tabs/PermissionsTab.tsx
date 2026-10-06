import Link from "next/link";
import Modal from "@/components/ui/Modal";
import { Banner, BUTTON_SECONDARY, INPUT } from "@/components/ui/kit";
import {
  allowsMultipleGrants,
  describeGrantScope,
  isMisplacedCommunityGrant,
  isOpenableModule,
  PERMISSION_MODULE_HINTS,
  PERMISSION_MODULE_LABELS,
  PERMISSION_MODULE_SECTIONS,
  type PermissionModuleKey,
} from "@/lib/permissions";
import { addPermissionGrantAction, removePermissionGrantAction, setModuleOpenAction, setPermissionGrantAction } from "../actions";

type GrantRow = {
  taskId: string;
  title: string;
  branchName: string;
  cycleId: string | null;
  cycleName: string | null;
};

export default function PermissionsTab({
  grantsFor,
  openModuleKeys,
  holdersByTaskId,
  sensitiveFieldsByModule,
  communityTasksForPicker,
  conflictReportsAtStake,
}: {
  grantsFor: (moduleKey: PermissionModuleKey) => GrantRow[];
  openModuleKeys: Set<PermissionModuleKey>;
  holdersByTaskId: Map<string, { memberId: string; name: string }[]>;
  sensitiveFieldsByModule: Map<PermissionModuleKey, string[]>;
  communityTasksForPicker: { id: string; title: string; branchName: string }[];
  // Existing conflict reports the whole team can read, which opening
  // `conflict_team` to everyone would hand to every member. Zero when it is
  // already open.
  conflictReportsAtStake: number;
}) {
  return (
    <div className="flex flex-col gap-7">
      <p className="max-w-[620px] text-[length:var(--text-body)] text-[var(--text-muted)]">
        A task grants what it sits in. Add or replace a grant from a row&rsquo;s{" "}
        <span className="text-[var(--text)]">Set</span> button; a task&rsquo;s own screen has the
        same control.
      </p>
      <datalist id="permissions-community-tasks">
        {communityTasksForPicker.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title} — {t.branchName}
          </option>
        ))}
      </datalist>
      {PERMISSION_MODULE_SECTIONS.map((section) => (
        <section key={section.key} className="flex flex-col gap-1">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{section.title}</h2>
          {section.moduleKeys.map((moduleKey) => (
            <PermissionRow
              key={moduleKey}
              moduleKey={moduleKey}
              scopeRule={section.rule}
              grants={grantsFor(moduleKey)}
              open={openModuleKeys.has(moduleKey)}
              openable={isOpenableModule(moduleKey)}
              holdersByTaskId={holdersByTaskId}
              sensitiveFieldsGatedByThisModule={sensitiveFieldsByModule.get(moduleKey) ?? []}
              reportsAtStake={moduleKey === "conflict_team" ? conflictReportsAtStake : 0}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * One role, as a row, with everything else behind a dialog.
 *
 * This tab has thirteen of these and every one used to be a card carrying a
 * hint, a checkbox, a blast-radius warning, a grant list, a "what this
 * scope is" line, a cardinality note and a search box. Thirteen of those is
 * a page nobody reads and everybody scrolls past — and the parts that
 * mattered (who holds it, is it open to everyone) were the smallest text on
 * each card. So the row carries the answer and the dialog carries the
 * explanation, which puts the copy where somebody has asked for it.
 *
 * What moved into the dialog and why, since each of these was on the page
 * for a reason:
 *
 *   - the module hint, unchanged, because it is what the dialog is for
 *   - `PERMISSION_MODULE_SECTIONS[].rule`, the per-section scope rule. It
 *     was a heading on every one of the thirteen cards' ancestors and said
 *     the same thing three times. It is now a `description` on the dialog,
 *     passed down from the section, so it is read once per role rather than
 *     skimmed once per section.
 *   - the blast-radius warning on `admin` and `support`. The comments in
 *     lib/permissions.ts call these the two highest-blast-radius modules
 *     and deliberately chose a warning over a confirm() because the surface
 *     was zero-JS. That reasoning has now been overtaken: the dialog *is* a
 *     confirm step, and it happens before the checkbox is even reachable.
 *   - the "nobody is holding this task, open it to put yourself forward"
 *     and misplaced-grant warnings, which are properties of a specific
 *     grant and belong next to that grant.
 *
 * The grant editing itself — datalist picker, Add/Replace, Remove — is
 * unchanged, and unchanged in being server-action forms. The dialog is a
 * client component only because `showModal()` is a DOM call; its children
 * are still server-rendered.
 */
function PermissionRow({
  moduleKey,
  scopeRule,
  grants,
  open,
  openable,
  holdersByTaskId,
  sensitiveFieldsGatedByThisModule,
  reportsAtStake,
}: {
  moduleKey: PermissionModuleKey;
  scopeRule: string;
  grants: GrantRow[];
  open: boolean;
  openable: boolean;
  holdersByTaskId: Map<string, { memberId: string; name: string }[]>;
  sensitiveFieldsGatedByThisModule: string[];
  reportsAtStake: number;
}) {
  const multi = allowsMultipleGrants(moduleKey);
  const label = PERMISSION_MODULE_LABELS[moduleKey];
  const holders = grants.reduce((n, g) => n + (holdersByTaskId.get(g.taskId)?.length ?? 0), 0);
  const unheld = open && grants.length > 0 && holders === 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] py-2 last:border-b-0">
      <div className="min-w-[12rem] flex-1">
        <p className="text-[length:var(--text-body)] text-[var(--text)]">{label}</p>
        <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{describeState(grants, open, holders)}</p>
      </div>
      {unheld && (
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">no one named</span>
      )}
      <Modal
        trigger="Set"
        triggerClassName={BUTTON_SECONDARY}
        title={label}
        description={
          <>
            {PERMISSION_MODULE_HINTS[moduleKey]}
            <span className="mt-1.5 block">{scopeRule}</span>
          </>
        }
        wide
      >
        {openable ? (
          <form action={setModuleOpenAction} className="flex flex-col gap-1.5">
            <input type="hidden" name="moduleKey" value={moduleKey} />
            <input type="hidden" name="tab" value="permissions" />
            <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <input type="checkbox" name="open" defaultChecked={open} className="mt-0.5" />
              <span>Everyone has this permission</span>
            </label>
            {/* D13's blast radius, and now a confirm step rather than a
                standing warning. `admin` and `support` are the two that
                genuinely change what the whole community can do. */}
            {blastRadiusOf(moduleKey) && (
              <p className="text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">
                {blastRadiusOf(moduleKey)}
              </p>
            )}
            {/* Opening the conflict team makes everyone a team member, and a
                team member can read every unacknowledged or escalated report.
                The server refuses without this box (setModuleOpen). */}
            {reportsAtStake > 0 && !open && (
              <label className="flex items-start gap-2 text-[length:var(--text-meta)] leading-relaxed text-[var(--warning)]">
                <input type="checkbox" name="confirmedReportExposure" className="mt-0.5" />
                <span>
                  {reportsAtStake} existing {reportsAtStake === 1 ? "report" : "reports"} would become readable by every
                  member, including anyone {reportsAtStake === 1 ? "it concerns" : "they concern"} who wasn&rsquo;t on the team
                  when {reportsAtStake === 1 ? "it was" : "they were"} filed, and so couldn&rsquo;t be excluded. Acknowledge or
                  resolve {reportsAtStake === 1 ? "it" : "them"} first, or tick this to open it anyway.
                </span>
              </label>
            )}
            {open && (
              <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                No task is needed while this is on. Keep one if you want someone named as
                responsible.
              </p>
            )}
            {sensitiveFieldsGatedByThisModule.length > 0 && (
              <p className="text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">
                Opening this does not unlock {sensitiveFieldsGatedByThisModule.join(", ")} — that is
                keyed to whoever <em>holds</em> the task.
              </p>
            )}
            <div>
              <button type="submit" className={BUTTON_SECONDARY}>
                {open ? "Turn off" : "Turn on"}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">
            This one can&rsquo;t be open to everyone: when nobody is named, there is nobody to notify.
            It needs a holder.
          </p>
        )}

        {unheld && (
          <Banner tone="warning">
            Open to everyone, and no task grants it — so nothing that routes work to a named person
            has anyone to route to.
          </Banner>
        )}

        {grants.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {grants.map((g) => {
              const taskHolders = holdersByTaskId.get(g.taskId) ?? [];
              return (
                <li key={g.taskId} className="flex flex-col gap-1 text-[length:var(--text-body)] text-[var(--text)]">
                  <div className="flex flex-wrap items-center gap-2">
                    {g.title} — {g.branchName}
                    <span className="text-[var(--text-muted)]">
                      — {describeGrantScope(moduleKey, g.cycleId, g.cycleName)}
                    </span>
                    <form action={removePermissionGrantAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="moduleKey" value={moduleKey} />
                      <input type="hidden" name="taskId" value={g.taskId} />
                      <input type="hidden" name="tab" value="permissions" />
                      {/* The last Admins grant is the one removal that opens
                          settings to every member (requireAdmins), so it is
                          asked for in the same breath rather than being
                          refused after the fact. The server enforces it too. */}
                      {moduleKey === "admin" && grants.length === 1 && (
                        <label className="flex items-center gap-1.5 text-[length:var(--text-micro)] text-[var(--text-muted)]">
                          <input type="checkbox" name="confirmedLastAdmin" />
                          This is the last one — let every member change settings until another is added
                        </label>
                      )}
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Remove
                      </button>
                    </form>
                  </div>
                  {/* D14. `capacity` is the real control on how many people
                      hold a role and nothing in the permission layer read
                      it, so a single-cardinality module could be handed to
                      five people with no indication here. */}
                  {taskHolders.length === 0 ? (
                    <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                      Nobody is holding this{" "}
                      <Link href={`/tasks/${g.taskId}`} className="text-[var(--accent-1)] hover:underline">
                        open the task
                      </Link>{" "}
                      to put yourself forward.
                    </p>
                  ) : (
                    <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                      {taskHolders.length <= 3 ? (
                        <>Held by {taskHolders.map((h) => h.name).join(", ")}</>
                      ) : (
                        <>
                          Held by{" "}
                          <Link href={`/tasks/${g.taskId}`} className="text-[var(--accent-1)] hover:underline">
                            {taskHolders.length} people
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                  {isMisplacedCommunityGrant(moduleKey, g.cycleId) && (
                    <Banner tone="warning">
                      This task sits in an event, but {label} is community-wide. It still grants
                      community-wide access.
                    </Banner>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
            {open
              ? "No task grants this, which is fine while it's open."
              : "No task grants this yet."}
          </p>
        )}

        {!multi && grants.length > 0 && (
          <p className="text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">
            One task per scope: adding a task in the same scope moves it here rather than adding a
            second.
          </p>
        )}

        <form
          action={multi ? addPermissionGrantAction : setPermissionGrantAction}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="moduleKey" value={moduleKey} />
          <input type="hidden" name="tab" value="permissions" />
          <input
            type="text"
            name="taskId"
            list="permissions-community-tasks"
            placeholder="search by task title…"
            className={`${INPUT} min-w-[16rem] flex-1`}
          />
          <button type="submit" className={BUTTON_SECONDARY}>
            {multi ? "Add" : grants.length > 0 ? "Replace" : "Grant"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

/** The row's whole job: who has this, in a line. Everything else about the
 *  role is behind the button. */
function describeState(grants: GrantRow[], open: boolean, holders: number): string {
  if (open) {
    return holders > 0 ? "open to everyone · also held by a task" : "open to everyone";
  }
  if (grants.length === 0) return "not granted to anyone";
  const tasks = grants.map((g) => g.title);
  const who = holders > 0 ? ` · ${holders} holder${holders === 1 ? "" : "s"}` : " · nobody holding it";
  return `${tasks.join(", ")}${who}`;
}

/** D13. Kept as a function rather than inline in the JSX so the two
 *  high-blast-radius modules are named in one place and the test can reach
 *  them. */
function blastRadiusOf(moduleKey: PermissionModuleKey): string | null {
  if (moduleKey === "support") {
    return "Every member will be able to view the platform read-only, exactly as any other member would — including the people who hold sensitive-data and permission access.";
  }
  if (moduleKey === "admin") {
    return "Every member will be able to change every setting, including who holds which permissions.";
  }
  return null;
}
