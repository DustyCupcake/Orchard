import { createHmac, randomBytes } from "node:crypto";

// Raw tokens (magic-link, session) live only in the emailed URL / cookie.
// What's stored in Postgres is an HMAC of the raw value, so a DB leak
// alone doesn't hand over usable credentials.
function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is not set");
  }
  return value;
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("base64url");
}
