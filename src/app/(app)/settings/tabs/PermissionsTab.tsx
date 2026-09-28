import Link from "next/link";
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

// The one settings tab that was already mostly right, and it stays
// mostly as it was: every access gate in one place, grouped by how far
// it reaches, with the per-module hint saying what holding the role
// *does* and the section header saying the scope rule the modules in it
// share. What it gains from the rest of the redesign is the card shell
// (a border and a title rather than a bare fieldset) and the fact that
// it is now a file rather than 90 lines of a 2000-line page.
//
// `recruitment_mediation` is new here and is worth reading twice: it is
// the only role whose holders see something everybody else is shielded
// from, and the only one that can make an exception decision about
// someone's arrival. Its hint says so in those words, because the
// settings panel is the only place anybody will read it.
export default function PermissionsTab({
  grantsFor,
  openModuleKeys,
  holdersByTaskId,
  sensitiveFieldsByModule,
  communityTasksForPicker,
}: {
  grantsFor: (moduleKey: PermissionModuleKey) => GrantRow[];
  openModuleKeys: Set<PermissionModuleKey>;
  holdersByTaskId: Map<string, { memberId: string; name: string }[]>;
  sensitiveFieldsByModule: Map<PermissionModuleKey, string[]>;
  communityTasksForPicker: { id: string; title: string; branchName: string }[];
}) {
  return (
    <div className="flex flex-col gap-7">
      <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
        Every access-gated capability in the app, in one place, grouped by how far each one reaches.
        One rule covers them all:{" "}
        <span className="text-[var(--text)]">a task grants what it sits in</span>. Add or replace a
        grant with the search-by-title picker. A task&rsquo;s own detail screen has the identical
        control, for whoever can edit that task.
      </p>
      <datalist id="permissions-community-tasks">
        {communityTasksForPicker.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title} — {t.branchName}
          </option>
        ))}
      </datalist>
      {PERMISSION_MODULE_SECTIONS.map((section) => (
        <section key={section.key} className="flex flex-col gap-3">
          <div>
            <h2 className="text-[22px] font-semibold text-[var(--text)]">{section.title}</h2>
            <p className="mt-1 max-w-[620px] text-[13px] text-[var(--text-muted)]">{section.rule}</p>
          </div>
          {section.moduleKeys.map((moduleKey) => (
            <GrantField
              key={moduleKey}
              moduleKey={moduleKey}
              grants={grantsFor(moduleKey)}
              open={openModuleKeys.has(moduleKey)}
              openable={isOpenableModule(moduleKey)}
              holdersByTaskId={holdersByTaskId}
              sensitiveFieldsGatedByThisModule={sensitiveFieldsByModule.get(moduleKey) ?? []}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

// Every access gate — single- or multi-cardinality alike — renders
// through this one component (docs/development-plan.md's Phase 64),
// replacing two separate stopgap components each tab used to render its
// own scattered field with. A single-cardinality module still enforces
// at most one grantee *per scope*: the Add form posts to
// setPermissionGrantAction (replaces the same scope's existing grant)
// rather than addPermissionGrantAction, with a static warning next to it
// once the same scope already has a grantee. Each row shows the granted
// task plus its derived scope — task — branch — {cycle name |
// Community-wide | Evergreen} via describeGrantScope. A community-shaped
// module's task that sits in a cycle renders a warning rather than being
// silently ignored.
//
// The field itself carries no scope language: the section header states
// the placement rule for every module in it, and the module's own hint
// says only what holding the role does. The Add input's `list` attribute
// wires it to the shared task datalist rendered once for the whole tab —
// a zero-JS "search by title" picker; the datalist's own <option value>
// is still the raw taskId (that's how HTML datalists work), so the
// input's text collapses to the ID once a suggestion is picked, but the
// human-readable label is what's actually searched while typing.
function GrantField({
  moduleKey,
  grants,
  open,
  openable,
  holdersByTaskId,
  sensitiveFieldsGatedByThisModule,
}: {
  moduleKey: PermissionModuleKey;
  grants: GrantRow[];
  open: boolean;
  openable: boolean;
  holdersByTaskId: Map<string, { memberId: string; name: string }[]>;
  sensitiveFieldsGatedByThisModule: string[];
}) {
  const multi = allowsMultipleGrants(moduleKey);
  const label = PERMISSION_MODULE_LABELS[moduleKey];
  // D13: the two highest-blast-radius modules, which stay openable
  // because a small Community may genuinely want them, but say plainly
  // what ticking the box means. Warn rather than hard-confirm — this
  // surface is deliberately zero-JS (the grant picker is a datalist,
  // Remove is a plain form), and a real confirm() would be the one
  // control here that changes access the instant it's pressed.
  const blastRadius =
    moduleKey === "support"
      ? "Every member will be able to view the platform exactly as any other member would, read-only — including as the people who hold sensitive-data and permission access."
      : moduleKey === "admin"
        ? "Every member will be able to change every Community setting, including who holds which permissions."
        : null;
  const holders = grants.reduce((n, g) => n + (holdersByTaskId.get(g.taskId)?.length ?? 0), 0);
  const unheld = open && grants.length > 0 && holders === 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-[15px] font-medium text-[var(--text)]">{label}</h3>
          <p className="mt-0.5 max-w-[560px] text-[12px] text-[var(--text-muted)]">
            {PERMISSION_MODULE_HINTS[moduleKey]}
          </p>
        </div>

        {/* The open checkbox, above the grant list so it reads as the
            primary fact when set and as a relaxation of the task list
            when not. */}
        {openable ? (
          <form action={setModuleOpenAction} className="flex flex-col gap-1.5">
            <input type="hidden" name="moduleKey" value={moduleKey} />
            <input type="hidden" name="tab" value="permissions" />
            <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
              <input type="checkbox" name="open" defaultChecked={open} className="mt-0.5" />
              <span>
                Everyone has this permission
                {open ? (
                  <span className="block text-[12px] text-[var(--text-muted)]">
                    Every member can do this. The task below is no longer required — keep it if you
                    want someone named as responsible.
                  </span>
                ) : null}
              </span>
            </label>
            {blastRadius && <p className="text-[12px] text-[var(--text-muted)]">{blastRadius}</p>}
            {sensitiveFieldsGatedByThisModule.length > 0 && (
              <p className="text-[12px] text-[var(--text-muted)]">
                Unlocking {sensitiveFieldsGatedByThisModule.join(", ")} is a separate setting, keyed
                to whoever <em>holds</em> this module&apos;s task. Opening the module does not change
                that.
              </p>
            )}
            <div>
              <button type="submit" className={BUTTON_SECONDARY}>
                {open ? "Turn off" : "Turn on"}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">
            This one can&rsquo;t be open to everyone — when nobody is named, there is nobody to
            notify. It needs a holder.
          </p>
        )}

        {unheld && (
          <Banner tone="warning">
            {label} is open to everyone and no task grants it, so nobody is named as responsible —
            anything that routes work to a named person has no one to route to.
          </Banner>
        )}

        {grants.length === 0 && !open && (
          <p className="text-[13px] text-[var(--text-muted)]">No task grants this yet.</p>
        )}
        {grants.length === 0 && open && (
          <p className="text-[13px] text-[var(--text-muted)]">
            No task grants this — which is fine while it&rsquo;s open, since no one needs to be named
            for it to work.
          </p>
        )}
        {grants.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {grants.map((g) => {
              const taskHolders = holdersByTaskId.get(g.taskId) ?? [];
              return (
                <li key={g.taskId} className="flex flex-col gap-1 text-[13px] text-[var(--text)]">
                  <div className="flex flex-wrap items-center gap-2">
                    {g.title} — {g.branchName}
                    <span className="text-[var(--text-muted)]">
                      {" "}
                      — {describeGrantScope(moduleKey, g.cycleId, g.cycleName)}
                    </span>
                    <form action={removePermissionGrantAction}>
                      <input type="hidden" name="moduleKey" value={moduleKey} />
                      <input type="hidden" name="taskId" value={g.taskId} />
                      <input type="hidden" name="tab" value="permissions" />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Remove
                      </button>
                    </form>
                  </div>
                  {/* D14. `capacity` is the real control on how many people
                      hold a role and nothing in the permission layer read
                      it, so a single-cardinality module could be handed to
                      five people with no indication here. Names at three or
                      fewer, count above, and the count always links to the
                      task — which already renders "Held by …" ungated. */}
                  {taskHolders.length === 0 ? (
                    <p className="text-[12px] text-[var(--text-muted)]">
                      Nobody is holding this{" "}
                      <Link href={`/tasks/${g.taskId}`} className="text-[var(--accent-1)] hover:underline">
                        open the task
                      </Link>{" "}
                      to put yourself forward.
                    </p>
                  ) : (
                    <p className="text-[12px] text-[var(--text-muted)]">
                      {taskHolders.length <= 3 ? (
                        <>Held by {taskHolders.map((h) => h.name).join(", ")} ({taskHolders.length})</>
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
                      This task sits in an event, but {label} is a community-wide role — keep its
                      event unset. It still grants community-wide access (the server is the source
                      of truth), so it isn&rsquo;t silently ignored.
                    </Banner>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!multi && grants.length > 0 && (
          <p className="text-[12px] text-[var(--text-muted)]">
            Only one task can hold this per scope — adding a task placed in the same scope (the same
            event, or community-wide for an event-independent task) moves it here instead of
            alongside it.
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
            className={`${INPUT} min-w-[18rem] flex-1`}
          />
          <button type="submit" className={BUTTON_SECONDARY}>
            {multi ? "Add" : grants.length > 0 ? "Replace" : "Grant"}
          </button>
        </form>
      </div>
    </div>
  );
}
