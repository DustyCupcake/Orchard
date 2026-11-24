// The settings tabs, in order. Shared by the page (which renders the bar and
// the active tab) and the settings search (whose results name the tab each
// setting lives on), so the two can't disagree about what a tab is called.
export const TABS = [
  { key: "general", label: "General" },
  { key: "permissions", label: "Access & permissions" },
  { key: "operations", label: "Operations" },
  { key: "recruitment", label: "Recruitment" },
  { key: "profile-privacy", label: "Profile & Privacy" },
  { key: "forms", label: "Forms" },
  { key: "history", label: "History" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];
