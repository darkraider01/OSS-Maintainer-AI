import { beforeAll, describe, expect, it } from 'vitest';
import { bootstrap } from '../../src/index.js';
import { runSqliteMigrations } from '../helpers/migrate-sqlite.js';
import { fakeClient } from '../helpers/fixtures.js';

/**
 * Final cross-flow validation (PRD §24), run through the *real* production
 * entry point (`bootstrap()` in src/index.ts) rather than the hand-wired
 * CommunicationService/EventBus/Runtime construction most other tests use —
 * proving the actual wiring works, not just the individual pieces in
 * isolation. Slack/Discord (Caspian) are fully exercisable here; the direct
 * GitHub webhook path (`GITHUB_ENABLED=true`) needs real App credentials
 * bootstrap() would require at module-load time (`env` is a parsed
 * singleton), so that path's coverage lives in the dedicated
 * `tests/gateway/github-*.test.ts` files instead, which construct
 * `GitHubGateway`/`webhook-server.ts` directly — same components, same
 * logic, just not through this literal function.
 */
function rawSlackMessage(id: string, conversationId: string, senderId: string, username: string, text: string) {
  return {
    id,
    conversationId,
    channel: 'slack',
    sender: { id: senderId, username },
    text,
    raw: { id, conversationId, channel: 'slack', sender: { id: senderId, username }, text },
  };
}

describe('Final cross-flow validation via bootstrap() (PRD §24)', () => {
  beforeAll(() => {
    runSqliteMigrations();
  });

  it('Issue Triage: multi-turn bug report to issue-ready response', async () => {
    const client = fakeClient();
    const runtime = await bootstrap({ client });
    (runtime.gateway as any).enabledChannels.add('slack');

    const conversationId = `C_FINAL_TRIAGE_${Date.now()}`;
    await runtime.gateway.ingest(
      rawSlackMessage(
        `${conversationId}_m1`,
        conversationId,
        'U_FINAL_1',
        'reporter',
        'The SDK crashes when I call connect(). Steps to reproduce: 1. install 2. run.'
      ) as any
    );

    expect(client.replies).toHaveLength(1);
    expect(client.replies[0].text).toContain('Could you provide');

    await runtime.gateway.ingest(
      rawSlackMessage(
        `${conversationId}_m2`,
        conversationId,
        'U_FINAL_1',
        'reporter',
        'SDK version 2.1.0, Ubuntu 24.04, node v20. Error: Connection refused\n```\nTraceback\n```'
      ) as any
    );

    expect(client.replies).toHaveLength(2);
    expect(client.replies[1].text).toContain('everything needed');

    await runtime.shutdown();
  });

  it('Contributor Onboarding: routes correctly and degrades honestly with no GitHub client wired', async () => {
    const client = fakeClient();
    const runtime = await bootstrap({ client });
    (runtime.gateway as any).enabledChannels.add('slack');

    await runtime.gateway.ingest(
      rawSlackMessage(
        `final_onboard_${Date.now()}`,
        `C_FINAL_ONBOARD_${Date.now()}`,
        'U_FINAL_2',
        'newcontributor',
        'How can I start contributing to this project?'
      ) as any
    );

    expect(client.replies).toHaveLength(1);
    // GITHUB_ENABLED is off in the test environment, so no live GitHub client
    // is wired — this proves the onboarding *route* fires correctly and
    // degrades honestly (PRD §8) rather than inventing setup instructions.
    // The happy path (real docs retrieved) is covered by
    // tests/core/onboarding-workflow.test.ts and
    // tests/core/contributor-profile-e2e.test.ts against a fake GitHub client.
    expect(client.replies[0].text).toMatch(/repository access|repository's documentation/i);

    await runtime.shutdown();
  });

  it('Human Escalation: detects, notifies, and stops autonomous replies until a human clears it', async () => {
    const client = fakeClient();
    const runtime = await bootstrap({ client });
    (runtime.gateway as any).enabledChannels.add('slack');

    const conversationId = `C_FINAL_ESCALATE_${Date.now()}`;
    await runtime.gateway.ingest(
      rawSlackMessage(
        `${conversationId}_m1`,
        conversationId,
        'U_FINAL_3',
        'reporter',
        'I found a security vulnerability — please escalate this to a maintainer.'
      ) as any
    );

    expect(client.replies).toHaveLength(1);
    expect(client.replies[0].text).toContain('looping in a maintainer');

    // A human hasn't cleared it — the agent must not reply again.
    await runtime.gateway.ingest(
      rawSlackMessage(`${conversationId}_m2`, conversationId, 'U_FINAL_3', 'reporter', 'Any update?') as any
    );

    expect(client.replies).toHaveLength(1);

    await runtime.shutdown();
  });

  it('GitHub, Slack, and Discord all converge on the exact same MaintainerAgent instance', async () => {
    const client = fakeClient();
    const runtime = await bootstrap({ client });
    (runtime.gateway as any).enabledChannels.add('slack');
    (runtime.gateway as any).enabledChannels.add('discord');

    const sharedAgent = runtime.agentRuntime.agentRegistry.find('maintainer-agent');
    expect(sharedAgent).toBeDefined();
    const seenOn: unknown[] = [];
    const originalExecute = sharedAgent!.execute.bind(sharedAgent);
    sharedAgent!.execute = async (context) => {
      seenOn.push(sharedAgent);
      return originalExecute(context);
    };

    const githubText = 'a general question';
    const githubConversationId = `C_CONV_GH_${Date.now()}`;
    await runtime.gateway.ingest({
      id: `conv_gh_${Date.now()}`,
      conversationId: githubConversationId,
      channel: 'github',
      sender: { id: '4242', login: 'octocat' },
      text: githubText,
      raw: {
        id: `conv_gh_${Date.now()}`,
        conversationId: githubConversationId,
        channel: 'github',
        sender: { id: '4242', login: 'octocat' },
        text: githubText,
      },
    } as any);

    await runtime.gateway.ingest(
      rawSlackMessage(`conv_slack_${Date.now()}`, `C_CONV_SLACK_${Date.now()}`, 'U_CONV', 'convuser', 'a general question') as any
    );

    const discordText = 'a general question';
    const discordConversationId = `C_CONV_DISCORD_${Date.now()}`;
    await runtime.gateway.ingest({
      id: `conv_discord_${Date.now()}`,
      conversationId: discordConversationId,
      channel: 'discord',
      sender: { id: 'D_CONV', username: 'discorduser' },
      text: discordText,
      raw: {
        id: `conv_discord_${Date.now()}`,
        conversationId: discordConversationId,
        channel: 'discord',
        sender: { id: 'D_CONV', username: 'discorduser' },
        text: discordText,
      },
    } as any);

    expect(seenOn).toHaveLength(3);
    expect(new Set(seenOn).size).toBe(1);
    expect(client.replies).toHaveLength(3);

    await runtime.shutdown();
  });
});
