import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { magicLinkToken } from "@/db/schema";
import { generateToken, hashToken } from "./token";
import { sendMagicLinkEmail } from "./mailer";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function requestMagicLink(email: string, appUrl: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db.insert(magicLinkToken).values({
    tokenHash: hashToken(token),
    email,
    expiresAt,
  });

  const url = new URL("/api/auth/verify", appUrl);
  url.searchParams.set("token", token);

  await sendMagicLinkEmail(email, url.toString());
}

// Marks the token consumed and returns the email it was issued for, or
// null if it's missing, already used, or expired.
export async function consumeMagicLink(rawToken: string): Promise<string | null> {
  const tokenHash = hashToken(rawToken);

  const [row] = await db
    .select()
    .from(magicLinkToken)
    .where(and(eq(magicLinkToken.tokenHash, tokenHash), isNull(magicLinkToken.consumedAt)));

  if (!row || row.expiresAt < new Date()) {
    return null;
  }

  await db
    .update(magicLinkToken)
    .set({ consumedAt: new Date() })
    .where(eq(magicLinkToken.tokenHash, tokenHash));

  return row.email;
}
