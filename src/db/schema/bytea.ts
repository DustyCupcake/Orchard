import { customType } from "drizzle-orm/pg-core";

// Postgres' binary column, which drizzle-kit has no first-class type for.
//
// Deliberately bytes rather than a URL: a Community's app icon has to keep
// working across a redeploy, and this deployment's only durable store is the
// database (the app container's filesystem is replaced on every image pull;
// the compose file's uploads volume exists but nothing writes to it yet).
// Keeping the icon here also means a database backup is a complete backup —
// see docs/spec.md's "A backup is only real if a restore..." — rather than
// one that silently omits the community's own branding.
export const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Buffer.from(value);
  },
});
