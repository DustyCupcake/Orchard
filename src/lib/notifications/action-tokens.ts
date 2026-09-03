import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { actionToken } from "@/db/schema";
import { generateToken, hashToken } from "../token";

// Shared one-time, click-to-act token infrastructure — see
// src/db/schema/action-token.ts's own comment for the full reasoning.
// Mirrors src/lib/magic-link.ts's requestMagicLink/consumeMagicLink
// almost exactly, generalized with a `kind` (so one consumer's tokens
// can never be replayed against a different one) and a typed payload
// instead of a hardcoded email column.

export async function issueActionToken<T>(kind: string, payload: T, ttlMs: number): Promise<string> {
  const token = generateToken();
  await db.insert(actionToken).values({
    tokenHash: hashToken(token),
    kind,
    payload: payload as object,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

// Marks the token consumed and returns its payload, or null if it's
// missing, was issued for a different kind, already used, or expired.
export async function consumeActionToken<T>(kind: string, rawToken: string): Promise<T | null> {
  const tokenHash = hashToken(rawToken);

  const [row] = await db
    .select()
    .from(actionToken)
    .where(and(eq(actionToken.tokenHash, tokenHash), eq(actionToken.kind, kind)));

  if (!row || row.consumedAt || row.expiresAt < new Date()) {
    return null;
  }

  await db.update(actionToken).set({ consumedAt: new Date() }).where(eq(actionToken.tokenHash, tokenHash));

  return row.payload as T;
}
