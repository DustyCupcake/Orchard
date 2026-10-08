export * from "./access";
export * from "./invites";
export * from "./inquiries";
export * from "./evaluations";
export * from "./applications";
export * from "./joining";
// The pure lane half (defaults, copy, presets, path semantics) has to be
// importable by a client component, so it deliberately does not come
// through this barrel's re-export chain — a client component importing
// `@/lib/recruitment` for `describeLaneConsequence` would pull the whole
// module graph, and with it drizzle, into the browser. It lives at
// `@/lib/recruitment/lanes` and says so on its own first line.
export * from "./joining-lanes";
// The derived stage (docs/admission-flow.md §4) is pure — no drizzle, no
// database, no clock of its own — so it is importable from a client
// component for the same reason lanes.ts is, and is kept out of this
// barrel for the same reason: a client component wanting
// `computeAdmissionStage` must be able to reach it without dragging the
// module graph in. It lives at `@/lib/recruitment/admission-stage`.
export * from "./subscriptions";
export * from "./decisions";
export * from "./objections";
export * from "./intro-call";
export * from "./pipeline";
export * from "./support";
export * from "./consensus";
export * from "./mediation";
export * from "./pairs";
