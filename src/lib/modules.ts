import { AppError } from "./errors";

// The flat on/off list docs/spec.md's Community.modules_enabled schema
// comment has described since Phase 1 — not the richer off/testing/on
// ModuleState (a Tier-scoped testing rollout stays out of scope, same
// as every other time this doc has mentioned it).
//
// "Sensitive data" was the first entry here and is gone as of migration
// 0080. It gated the four fixed `member` columns and the `/sensitive-data`
// grid, and once those became profile questions it gated nothing a
// question did — a checkbox reading as a privacy control while having no
// effect on what any member could read. The per-question access rules are
// the real mechanism, and they're configured in Settings, not here.
export const MODULE_DEFINITIONS = [
  { key: "budget", label: "Budget" },
  { key: "event_scheduling", label: "Programme" },
  { key: "shifts", label: "Shifts / rota" },
  { key: "recruitment", label: "Recruitment" },
  { key: "spatial_planning", label: "Spatial planning" },
  { key: "kitchen", label: "Kitchen" },
] as const;
export type ModuleKey = (typeof MODULE_DEFINITIONS)[number]["key"];

export function isModuleEnabled(community: { modulesEnabled: string[] }, key: string) {
  return community.modulesEnabled.includes(key);
}

export function requireModuleEnabled(community: { modulesEnabled: string[] }, key: string) {
  if (!isModuleEnabled(community, key)) {
    throw new AppError(`The "${key}" module isn't enabled for this Community`);
  }
}
