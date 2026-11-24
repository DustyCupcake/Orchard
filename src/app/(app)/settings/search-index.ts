import { PERMISSION_MODULE_KEYS, PERMISSION_MODULE_LABELS } from "@/lib/permissions";
import { TABS, type TabKey } from "./tabs";
import type { SettingsSearchEntry } from "./search";

// What the settings search can find. Hand-listed on purpose: the tabs are
// server components that each load only their own data, so there is no one
// place that has rendered every setting to read titles back from. The cost of
// a hand-written list is drift, and tests/settings-search.test.ts pays it
// down — every `anchor` below must exist as an `id` in the settings source,
// and the index must reach every tab.
//
// One entry per setting a person would go looking for (a section or a card),
// not per field. `anchor` is the `id` on that section/card/group; the search
// box opens it if it is a collapsed card.

type Row = {
  tab: TabKey;
  anchor: string | null;
  title: string;
  summary: string;
  keywords?: string;
};

const ROWS: Row[] = [
  // --- General ---
  { tab: "general", anchor: "general-basics", title: "The basics", summary: "What the community is called, and the two structural switches everything else hangs off.", keywords: "name community rename" },
  { tab: "general", anchor: "name-and-structure", title: "Name and structure", summary: "Community name, time zone, whether it runs events, whether events have phases, how dates are displayed.", keywords: "name time zone timezone events phases cycles date format display" },
  { tab: "general", anchor: "call-defaults", title: "What a call needs to be finished", summary: "Community-wide call defaults — agenda, summary, read confirmation — which a branch can override.", keywords: "calls meetings agenda summary minutes read confirmation" },
  { tab: "general", anchor: "look", title: "Look", summary: "Colours, logo and the app icon.", keywords: "branding appearance theme" },
  { tab: "general", anchor: "branding", title: "Colours and logo", summary: "The community's colours and sidebar logo.", keywords: "colors brand branding theme logo accent" },
  { tab: "general", anchor: "app-icon", title: "App icon", summary: "The square icon shown in browser tabs and on phone home screens.", keywords: "favicon icon pwa home screen install manifest logo png" },
  { tab: "general", anchor: "signing-in", title: "Signing in", summary: "Magic-link sign-in is always on; single sign-on is a second way in.", keywords: "login log in authentication magic link" },
  { tab: "general", anchor: "sso", title: "Single sign-on (OIDC)", summary: "Configure an OIDC provider, and whether it is the main way in.", keywords: "sso oidc zitadel openid identity provider issuer client secret login" },
  { tab: "general", anchor: "branches", title: "Branches", summary: "The community's branches: add, rename, confirm or remove them.", keywords: "teams groups working groups circles" },

  // --- Access & permissions ---
  { tab: "permissions", anchor: "tiers", title: "Tiers", summary: "A bar somebody has to clear — gates starting an event, holding a role, seeing a field.", keywords: "levels criteria membership standing eligibility" },
  // (one entry per permission module is added in buildSettingsIndex)

  // --- Operations ---
  { tab: "operations", anchor: "deadlines", title: "Deadlines", summary: "How long somebody gets before a thing is somebody else's problem.", keywords: "timing clocks windows overdue" },
  { tab: "operations", anchor: "response-windows", title: "Response windows", summary: "How long a conflict report can be overdue, and how long a task nomination or a call summary waits.", keywords: "response time hours days conflict nominations call summary overdue unread" },
  { tab: "operations", anchor: "response-tracking", title: "Response tracking", summary: "Reads engagement patterns across the app and puts them in a member's profile.", keywords: "engagement responsiveness activity" },
  { tab: "operations", anchor: "pattern-thresholds", title: "When a pattern is a pattern", summary: "The thresholds: one response is ordinary, a few worth noticing, more a pattern.", keywords: "threshold ladder responses" },
  { tab: "operations", anchor: "indicators", title: "Indicators", summary: "Community indicators — patterns the data shows about who takes part, shown on Members.", keywords: "statistics participation diversity members page" },
  { tab: "operations", anchor: "event-breakout", title: "Breaking out a single event", summary: "Whether the member directory and its indicators may narrow to one event at a time.", keywords: "privacy small populations identifiable members directory" },
  { tab: "operations", anchor: "modules", title: "What's switched on (modules)", summary: "Turn whole areas of the app on or off: kitchen, shifts, budget and the rest.", keywords: "modules enable disable features kitchen shifts budget programme spatial planning recruitment" },
  { tab: "operations", anchor: "budget", title: "Budget", summary: "Anyone can propose spending; others back it; the budget's owner approves.", keywords: "money spending funds proposals backing" },
  { tab: "operations", anchor: "budget-backing", title: "How much backing a proposal needs", summary: "A proposal can't be approved for more than its backers cover.", keywords: "support per backer fund excess" },
  { tab: "operations", anchor: "after-event", title: "After an event", summary: "One standing question, asked of everyone once an event is over.", keywords: "feedback survey post event" },
  { tab: "operations", anchor: "feedback-ask", title: "The feedback ask", summary: "Which form goes out when an event closes.", keywords: "post-event feedback form survey" },

  // --- Recruitment ---
  { tab: "recruitment", anchor: "admission-lanes", title: "Admission lanes", summary: "The ways someone arrives, and what happens next on each.", keywords: "invite invitation apply application join joining vouch interview" },
  { tab: "recruitment", anchor: "application", title: "The application", summary: "Which form, who reads it, and what a decline starts from.", keywords: "application form readers decline evaluation reviewers" },
  { tab: "recruitment", anchor: "report-policy", title: "How reports decide", summary: "What a full set of reports means — one policy for every lane that has one.", keywords: "reports reviewers decision votes quorum" },
  { tab: "recruitment", anchor: "community-check", title: "Community check", summary: "Lanes announce arrivals to the community, and any member can raise a concern.", keywords: "announce arrivals discussion concern objection window" },
  { tab: "recruitment", anchor: "community-check-window", title: "How long a community check runs", summary: "The one window every community check runs for.", keywords: "days duration concern" },
  { tab: "recruitment", anchor: "doors", title: "Doors", summary: "Applications, invitations and interviews — independent doors you can close.", keywords: "open closed applications invites interviews closed community" },
  { tab: "recruitment", anchor: "doors-open", title: "Open right now?", summary: "Open or close each door. Close all three to run fully closed.", keywords: "applications invites interviews toggle" },
  { tab: "recruitment", anchor: "interview", title: "The interview", summary: "What an applicant is offered around their conversation with the people looking after joining.", keywords: "interviewers conversation" },
  { tab: "recruitment", anchor: "interview-inviter", title: "The person who invited them", summary: "Whether an invited applicant can ask their inviter to be at the interview.", keywords: "inviter sponsor company" },
  { tab: "recruitment", anchor: "accompaniment", title: "Accompaniment", summary: "Someone there for a new member from the start, to ask and to check in with.", keywords: "buddy mentor onboarding new member welcome" },
  { tab: "recruitment", anchor: "accompaniment-on", title: "Does a new member get someone?", summary: "Whether new members are accompanied, by whom, and for how long.", keywords: "buddy mentor onboarding duration" },
  { tab: "recruitment", anchor: "check-ins", title: "Check-ins", summary: "Milestones on the accompaniment task, shown on the accompanier's dashboard.", keywords: "milestones follow up accompaniment dashboard" },

  // --- Profile & Privacy ---
  { tab: "profile-privacy", anchor: "profile-questions", title: "Profile questions", summary: "Standing facts about a member — once-ever, per-event or per phase — including archived ones.", keywords: "questions profile fields emergency contact archived restricted audience sensitive public" },
  { tab: "profile-privacy", anchor: "trait-axes", title: "Trait axes", summary: "Bipolar scales set on members and tasks, used for matching.", keywords: "traits scales matching preference" },
  { tab: "profile-privacy", anchor: "consent-purposes", title: "Consent purposes", summary: "One row per purpose that needs a member's consent.", keywords: "gdpr privacy consent data" },

  // --- Forms ---
  { tab: "forms", anchor: "forms-list", title: "Forms", summary: "Every set of questions in the app: the application, feedback, polls and so on.", keywords: "form builder fields application feedback poll questionnaire survey" },

  // --- History ---
  { tab: "history", anchor: null, title: "History", summary: "The change log: every settings change, who made it and when.", keywords: "audit log changes who changed undo record" },
];

const KITCHEN_ROW: Row = {
  tab: "profile-privacy",
  anchor: "kitchen-questions",
  title: "Kitchen questions",
  summary: "Which profile questions tell the kitchen about allergies, intolerances, dislikes and diet.",
  keywords: "kitchen dietary allergy allergies intolerance dislike diet vegan vegetarian food",
};

const TAB_LABEL = new Map<string, string>(TABS.map((t) => [t.key, t.label]));

function toEntry(row: Row): SettingsSearchEntry {
  return {
    tab: row.tab,
    tabLabel: TAB_LABEL.get(row.tab) ?? row.tab,
    anchor: row.anchor,
    title: row.title,
    summary: row.summary,
    keywords: row.keywords ?? "",
  };
}

/** The anchors every hand-listed entry points at, for the drift test. */
export const SETTINGS_INDEX_ANCHORS: readonly string[] = [...ROWS, KITCHEN_ROW]
  .map((r) => r.anchor)
  .filter((a): a is string => a !== null);

/** The id the permission row for a module carries — see PermissionsTab. */
export function permissionAnchor(moduleKey: string): string {
  return `permission-${moduleKey}`;
}

/**
 * The entries for the search box, in tab order. The Kitchen question card is
 * only on the page while the Kitchen module is on, so it is only offered then.
 */
export function buildSettingsIndex({ kitchenEnabled }: { kitchenEnabled: boolean }): SettingsSearchEntry[] {
  const rows = ROWS.flatMap((row) => {
    const out = [row];
    if (row.tab === "permissions" && row.anchor === "tiers") {
      // Who can do what: one row per module, so "budget owner" or "programme"
      // finds its own line rather than only the tab.
      for (const moduleKey of PERMISSION_MODULE_KEYS) {
        out.push({
          tab: "permissions",
          anchor: permissionAnchor(moduleKey),
          title: PERMISSION_MODULE_LABELS[moduleKey],
          summary: "Which task grants this role, or whether it is open to everyone.",
          keywords: "permission role grant access holder owner who can",
        });
      }
    }
    if (row.tab === "profile-privacy" && row.anchor === "profile-questions" && kitchenEnabled) {
      out.push(KITCHEN_ROW);
    }
    return out;
  });
  return rows.map(toEntry);
}
