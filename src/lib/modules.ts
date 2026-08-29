import { AppError } from "./errors";

// The flat on/off list docs/spec.md's Community.modules_enabled schema
// comment has described since Phase 1 — not the richer off/testing/on
// ModuleState (a Tier-scoped testing rollout stays out of scope, same
// as every other time this doc has mentioned it). Sensitive data is
// the first real consumer; later optional modules (Budget, Shifts,
// Spatial planning, ...) register here too rather than each inventing
// their own gate.
export const MODULE_DEFINITIONS = [
  { key: "sensitive_data", label: "Sensitive data" },
  { key: "budget", label: "Budget" },
  { key: "event_scheduling", label: "Event scheduling" },
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
