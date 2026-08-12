import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { getContributorHistory } from '../../src/core/knowledge/contributor-history-service.js';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { db } from '../../src/db/client.js';
import { messages } from '../../src/db/schema/messages.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import { fakeGitHubClient } from '../helpers/fixtures.js';

async function seedMessages(actorId: string, count: number): Promise<void> {
  const conversationId = randomUUID();
  for (let i = 0; i < count; i++) {
    await db.insert(messages).values({
      id: randomUUID(),
      conversationId,
      senderActorId: actorId,
      content: `message ${i}`,
      createdAt: new Date(),
    });
  }
}

describe('getContributorHistory', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('returns only the message count when no GitHub client/repository is provided', async () => {
    const identity = new IdentityService();
    const actorId = await identity.resolveActor({
      provider: 'discord',
      providerUserId: `history-${randomUUID()}`,
      username: 'someone',
    });
    await seedMessages(actorId, 3);

    const history = await getContributorHistory(actorId, null);

    expect(history).toEqual({ messagesSent: 3, issuesOpened: 0, pullRequestsOpened: 0 });
  });

  it('returns zero issue/PR counts when the actor has no linked GitHub account', async () => {
    const identity = new IdentityService();
    const actorId = await identity.resolveActor({
      provider: 'discord',
      providerUserId: `history-nogh-${randomUUID()}`,
      username: 'someone',
    });
    await seedMessages(actorId, 2);
    const client = fakeGitHubClient();

    const history = await getContributorHistory(actorId, client, {
      owner: 'darkraider01',
      repo: 'OSS-Maintainer-AI',
    });

    expect(history.messagesSent).toBe(2);
    expect(history.issuesOpened).toBe(0);
    expect(history.pullRequestsOpened).toBe(0);
  });

  it('fetches GitHub issue/PR counts when the actor has a linked GitHub account', async () => {
    const identity = new IdentityService();
    const actorId = await identity.resolveActor({
      provider: 'github',
      providerUserId: `gh-${randomUUID()}`,
      username: 'octocat',
    });
    await seedMessages(actorId, 5);
    const client = fakeGitHubClient([], {
      activity: { octocat: { issuesOpened: 4, pullRequestsOpened: 2 } },
    });

    const history = await getContributorHistory(actorId, client, {
      owner: 'darkraider01',
      repo: 'OSS-Maintainer-AI',
    });

    expect(history).toEqual({ messagesSent: 5, issuesOpened: 4, pullRequestsOpened: 2 });
  });
});
