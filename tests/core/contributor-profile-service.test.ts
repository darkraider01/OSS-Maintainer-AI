import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { actors } from '../../src/db/schema/actors.js';
import { actorAccounts } from '../../src/db/schema/actor_accounts.js';
import {
  ContributorProfileService,
  formatContributorProfileForPrompt,
} from '../../src/core/contributor/contributor-profile-service.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

describe('ContributorProfileService (#22)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('returns null for an unknown actor', async () => {
    const service = new ContributorProfileService();
    const profile = await service.build(randomUUID());
    expect(profile).toBeNull();
  });

  it('aggregates connected accounts and marks onboarding state', async () => {
    const actorId = randomUUID();
    await db
      .insert(actors)
      .values({ id: actorId, type: 'human', createdAt: new Date(), updatedAt: new Date() });
    await db.insert(actorAccounts).values({
      id: randomUUID(),
      actorId,
      provider: 'github' as any,
      providerUserId: 'gh_1',
      username: 'octocat',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = new ContributorProfileService();
    const before = await service.build(actorId);
    expect(before?.onboardedAt).toBeNull();
    expect(before?.connectedAccounts).toEqual([{ provider: 'github', username: 'octocat' }]);
    expect(before?.channelsUsed).toEqual(['github']);

    await service.recordOnboarded(actorId);
    const after = await service.build(actorId);
    expect(after?.onboardedAt).not.toBeNull();
  });

  it('does not infer or score anything beyond the raw counts/flags it collected', async () => {
    const actorId = randomUUID();
    await db
      .insert(actors)
      .values({ id: actorId, type: 'human', createdAt: new Date(), updatedAt: new Date() });
    const service = new ContributorProfileService();
    const profile = await service.build(actorId);
    expect(Object.keys(profile!).sort()).toEqual(
      [
        'actorId',
        'channelsUsed',
        'connectedAccounts',
        'firstSeenAt',
        'githubActivity',
        'messagesSent',
        'onboardedAt',
      ].sort()
    );
  });
});

describe('formatContributorProfileForPrompt', () => {
  it('handles a missing profile', () => {
    expect(formatContributorProfileForPrompt(null)).toContain('No contributor profile available');
  });

  it('summarizes a first-time, not-yet-onboarded contributor', () => {
    const text = formatContributorProfileForPrompt({
      actorId: 'a',
      firstSeenAt: new Date().toISOString(),
      onboardedAt: null,
      connectedAccounts: [],
      messagesSent: 1,
      channelsUsed: [],
      githubActivity: null,
    });
    expect(text).toContain('first message from this contributor');
    expect(text).toContain('not yet onboarded');
  });
});
