import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { linkSessions } from '../db/schema/link_sessions.js';

/** One linking sitting is expected to take a couple of minutes, not a login that persists. */
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface LinkSession {
  id: string;
  actorId: string | null;
  expiresAt: Date;
}

export async function createLinkSession(): Promise<LinkSession> {
  const id = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(linkSessions).values({ id, actorId: null, createdAt: now, expiresAt });
  return { id, actorId: null, expiresAt };
}

/** Returns `null` for a missing or expired session — callers treat both as "start over". */
export async function getLinkSession(id: string): Promise<LinkSession | null> {
  const [row] = await db.select().from(linkSessions).where(eq(linkSessions.id, id));
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;
  return { id: row.id, actorId: row.actorId, expiresAt: new Date(row.expiresAt) };
}

export async function setLinkSessionActor(id: string, actorId: string): Promise<void> {
  await db.update(linkSessions).set({ actorId }).where(eq(linkSessions.id, id));
}
