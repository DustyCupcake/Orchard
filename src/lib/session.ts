import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { member, session as sessionTable } from "@/db/schema";
import { generateToken, hashToken } from "./token";

export const SESSION_COOKIE = "orchard_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Creates a session row and sets the cookie. Only callable from a Route
// Handler or Server Action — Server Components can't set cookies.
export async function createSession(memberId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessionTable).values({
    tokenHash: hashToken(token),
    memberId,
    expiresAt,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

// Reads the session cookie and returns the logged-in Member, or null.
// Safe to call from Server Components (read-only).
export async function getCurrentMember() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const [row] = await db
    .select({ member, expiresAt: sessionTable.expiresAt })
    .from(sessionTable)
    .innerJoin(member, eq(sessionTable.memberId, member.id))
    .where(eq(sessionTable.tokenHash, hashToken(token)));

  if (!row || row.expiresAt < new Date()) {
    return null;
  }

  return row.member;
}

// Deletes the session row and clears the cookie. Only callable from a
// Route Handler or Server Action.
export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessionTable).where(eq(sessionTable.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}
