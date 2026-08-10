import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { IdentityService } from '../../src/gateway/adapters/identity-service.js';
import { db } from '../../src/db/client.js';
import { actors } from '../../src/db/schema/actors.js';
import { actorAccounts } from '../../src/db/schema/actor_accounts.js';
import { messages } from '../../src/db/schema/messages.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';

describe('IdentityService.linkProviderToActor', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('attaches a brand-new provider identity to the target actor', async () => {
    const identity = new IdentityService();
    const targetActorId = await identity.resolveActor({
      provider: 'discord',
      providerUserId: `discord-target-${randomUUID()}`,
      username: 'target_user',
    });

    const result = await identity.linkProviderToActor(targetActorId, {
      provider: 'github',
      providerUserId: `github-new-${randomUUID()}`,
      username: 'target_on_github',
    });

    expect(result).toEqual({ actorId: targetActorId, merged: false });
    const [account] = await db
      .select()
      .from(actorAccounts)
      .where(eq(actorAccounts.actorId, targetActorId));
    expect(account.username).toBeDefined();
  });

  it('is a no-op when the provider identity is already linked to the target actor', async () => {
    const identity = new IdentityService();
    const providerUserId = `slack-noop-${randomUUID()}`;
    const targetActorId = await identity.resolveActor({
      provider: 'slack',
      providerUserId,
      username: 'already_linked',
    });

    const result = await identity.linkProviderToActor(targetActorId, {
      provider: 'slack',
      providerUserId,
      username: 'already_linked',
    });

    expect(result).toEqual({ actorId: targetActorId, merged: false });
  });

  it('merges a pre-existing actor into the target: accounts and message history move over, source actor is deleted', async () => {
    const identity = new IdentityService();

    const targetActorId = await identity.resolveActor({
      provider: 'github',
      providerUserId: `github-target-${randomUUID()}`,
      username: 'human_github',
    });

    const sourceProviderUserId = `discord-source-${randomUUID()}`;
    const sourceActorId = await identity.resolveActor({
      provider: 'discord',
      providerUserId: sourceProviderUserId,
      username: 'human_discord',
    });

    const conversationId = randomUUID();
    await db.insert(messages).values({
      id: randomUUID(),
      conversationId,
      senderActorId: sourceActorId,
      content: 'hello from discord',
      createdAt: new Date(),
    });

    const result = await identity.linkProviderToActor(targetActorId, {
      provider: 'discord',
      providerUserId: sourceProviderUserId,
      username: 'human_discord',
    });

    expect(result).toEqual({ actorId: targetActorId, merged: true });

    const discordAccount = await db
      .select()
      .from(actorAccounts)
      .where(eq(actorAccounts.providerUserId, sourceProviderUserId));
    expect(discordAccount[0].actorId).toBe(targetActorId);

    const movedMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    expect(movedMessages[0].senderActorId).toBe(targetActorId);

    const remainingSourceActor = await db.select().from(actors).where(eq(actors.id, sourceActorId));
    expect(remainingSourceActor).toHaveLength(0);
  });

  it('refuses to merge a bot/agent actor into a human actor', async () => {
    const identity = new IdentityService();

    const targetActorId = await identity.resolveActor({
      provider: 'github',
      providerUserId: `github-human-${randomUUID()}`,
      username: 'human',
    });

    const botProviderUserId = `bot-${randomUUID()}`;
    const botActorId = await identity.resolveActor({
      provider: 'discord',
      providerUserId: botProviderUserId,
      username: 'maintainer_bot',
    });
    await db.update(actors).set({ type: 'bot' }).where(eq(actors.id, botActorId));

    const result = await identity.linkProviderToActor(targetActorId, {
      provider: 'discord',
      providerUserId: botProviderUserId,
      username: 'maintainer_bot',
    });

    expect(result).toEqual({ actorId: targetActorId, merged: false });

    const botAccount = await db
      .select()
      .from(actorAccounts)
      .where(eq(actorAccounts.providerUserId, botProviderUserId));
    expect(botAccount[0].actorId).toBe(botActorId);

    const stillExists = await db.select().from(actors).where(eq(actors.id, botActorId));
    expect(stillExists).toHaveLength(1);
  });
});
