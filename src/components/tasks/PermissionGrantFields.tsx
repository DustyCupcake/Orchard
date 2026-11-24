import type { ReactNode } from "react";
import Link from "next/link";
import { CheckField } from "@/components/ui/kit";
import {
  describeGrantScope,
  isMisplacedCommunityGrant,
  PERMISSION_MODULE_LABELS,
  PERMISSION_MODULE_SECTIONS,
  TASK_GRANTABLE_PERMISSION_MODULE_KEYS,
  type PermissionModuleKey,
} from "@/lib/permissions";

// The checkbox list every task-side grant editor uses. The settings panel
// lists all modules grouped by reach; the task and proposal editors used to
// render a flat 14-item list that simply dropped Budget, which made the two
// surfaces look like different permission systems. Here they show the same
// grouped list, with the settings-only modules present but disabled — so the
// rules stay identical while the interfaces read as one.
const TASK_GRANTABLE = new Set<PermissionModuleKey>(TASK_GRANTABLE_PERMISSION_MODULE_KEYS);

function settingsHref(moduleKey: PermissionModuleKey): string {
  // Matches permissionAnchor() + settingsEntryHref() in the settings search.
  return `/settings?tab=permissions#permission-${moduleKey}`;
}

export default function PermissionGrantFields({
  name,
  grantedModuleKeys,
  elsewhereHolderByModule = {},
  cycle,
  noteByModule,
}: {
  name: string;
  /** What the task already grants, including settings-only modules. */
  grantedModuleKeys?: ReadonlySet<PermissionModuleKey>;
  elsewhereHolderByModule?: Partial<Record<PermissionModuleKey, string>>;
  /** Omit when the new task's placement isn't decided yet (proposals). */
  cycle?: { id: string | null; name: string | null };
  noteByModule?: Partial<Record<PermissionModuleKey, ReactNode>>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {PERMISSION_MODULE_SECTIONS.map((section) => (
        <fieldset key={section.key}>
          <legend className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
            {section.title}
          </legend>
          <div className="mt-1 flex flex-col gap-2">
            {section.moduleKeys.map((moduleKey) => {
              const locked = !TASK_GRANTABLE.has(moduleKey);
              const granted = grantedModuleKeys?.has(moduleKey) ?? false;
              const heldElsewhere = elsewhereHolderByModule[moduleKey];
              return (
                <div key={moduleKey}>
                  <CheckField
                    label={PERMISSION_MODULE_LABELS[moduleKey]}
                    name={name}
                    value={moduleKey}
                    defaultChecked={granted}
                    disabled={locked}
                  />
                  {locked ? (
                    <p className="ml-6 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                      Configured only in{" "}
                      <Link href={settingsHref(moduleKey)} className="text-[var(--accent-1)] hover:underline">
                        Settings &rarr; Access &amp; permissions
                      </Link>
                      {granted ? " — already set on this task from there" : ""}.
                    </p>
                  ) : (
                    <>
                      {cycle && (
                        <p className="ml-6 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                          {describeGrantScope(moduleKey, cycle.id, cycle.name)}
                          {isMisplacedCommunityGrant(moduleKey, cycle.id) && (
                            <>
                              {" "}
                              &mdash; but this task sits in an event, which contradicts a community-wide
                              role. The grant still counts community-wide.
                            </>
                          )}
                        </p>
                      )}
                      {noteByModule?.[moduleKey] && (
                        <p className="ml-6 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                          {noteByModule[moduleKey]}
                        </p>
                      )}
                      {heldElsewhere && (
                        <p className="ml-6 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                          Currently held by &ldquo;{heldElsewhere}&rdquo; — checking this moves it here.
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
