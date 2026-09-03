import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { member, session as sessionTable, viewAsLog } from "@/db/schema";
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

// Reads the session cookie and returns the full row — real member plus
// the session's own columns (including View-as's overlay, see
// src/lib/view-as.ts). Safe to call from Server Components (read-only).
// Wrapped in React's cache() since the (app) shell layout now calls
// this (via getCurrentMember, below) on every authenticated page in
// addition to the page itself — dedupes to one query per request
// instead of two, and getCurrentMember/view-as.ts's own
// session-reading functions all build on this one query rather than
// each running their own.
export const getCurrentSession = cache(async function getCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const [row] = await db
    .select({ member, session: sessionTable })
    .from(sessionTable)
    .innerJoin(member, eq(sessionTable.memberId, member.id))
    .where(eq(sessionTable.tokenHash, hashToken(token)));

  if (!row || row.session.expiresAt < new Date()) {
    return null;
  }

  return row;
});

// Reads the session cookie and returns the logged-in Member, or null —
// always the *real* identity behind the session, never a View-as
// overlay target. Pages that want View-as-aware rendering call
// src/lib/view-as.ts's getViewingContext instead; this stays the right
// call for anything that must never be spoofed (the redirect-to-login
// check, a Server Action's own actor, the banner).
export const getCurrentMember = cache(async function getCurrentMember() {
  const session = await getCurrentSession();
  return session?.member ?? null;
});

// The one place a session row's View-as overlay columns get written —
// owned here since this file already owns cookie/session-row access;
// src/lib/view-as.ts calls this rather than touching the session table
// directly. Passing null clears the overlay.
export async function setViewAsOverlay(targetMemberId: string | null) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return;

  await db
    .update(sessionTable)
    .set({
      viewingAsMemberId: targetMemberId,
      viewingAsStartedAt: targetMemberId ? new Date() : null,
    })
    .where(eq(sessionTable.tokenHash, hashToken(token)));
}

// Deletes the session row and clears the cookie. Only callable from a
// Route Handler or Server Action.
export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    // Closing out a still-open View-as log before the session row that
    // carried the overlay disappears — see src/db/schema/view-as.ts's
    // own comment on why an unclosed row is misleading, not unsafe (the
    // capability itself is already gone the moment the session is).
    const [row] = await db
      .select({ memberId: sessionTable.memberId, viewingAsMemberId: sessionTable.viewingAsMemberId })
      .from(sessionTable)
      .where(eq(sessionTable.tokenHash, hashToken(token)));
    if (row?.viewingAsMemberId) {
      await db
        .update(viewAsLog)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(viewAsLog.activatedBy, row.memberId),
            eq(viewAsLog.targetMemberId, row.viewingAsMemberId),
            isNull(viewAsLog.endedAt),
          ),
        );
    }
    await db.delete(sessionTable).where(eq(sessionTable.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}
