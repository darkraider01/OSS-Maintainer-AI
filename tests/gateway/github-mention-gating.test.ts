import { describe, expect, it, vi } from 'vitest';
import { GitHubGateway } from '../../src/gateway/github-gateway.js';
import { signGitHubPayload } from '../../src/gateway/github/webhook-signature.js';
import type { ICommunicationService } from '../../src/gateway/adapters/communication-types.js';
import { issueCommentPayload } from '../helpers/fixtures.js';

const SECRET = 'ghsec_mentions_test';

function delivery(body: string, headers: Record<string, string> = {}) {
  return {
    body,
    headers: {
      'x-github-event': 'issue_comment',
      'x-github-delivery': 'delivery-mention-1',
      'x-hub-signature-256': signGitHubPayload(body, SECRET),
      ...headers,
    },
  };
}

describe('GitHub mention gating (GITHUB_RECEIVE_MODE=mentions)', () => {
  it('accepts a comment that @-mentions the bot as GitHub actually renders it (no [bot] suffix)', async () => {
    const ingest = vi.fn().mockResolvedValue({ eventId: 'x', payload: { conversationId: 'c', actorId: 'a' } });
    const communicationService: ICommunicationService = { ingest };

    const gateway = new GitHubGateway({
      communicationService,
      webhookSecret: SECRET,
      receiveMode: 'mentions',
      botLogin: 'ossmaintainer-ai[bot]', // the bot's real GitHub login
    });

    const body = JSON.stringify(
      issueCommentPayload({
        comment: {
          id: 1,
          body: 'Hey @ossmaintainer-ai can you take a look at this?',
          user: { id: 5150, login: 'contributor-two' },
        },
      })
    );

    const result = await gateway.handleWebhook(delivery(body));

    expect(result.status).toBe('accepted');
    expect(ingest).toHaveBeenCalledOnce();
  });

  it('ignores a comment that does not mention the bot', async () => {
    const ingest = vi.fn().mockResolvedValue({ eventId: 'x', payload: { conversationId: 'c', actorId: 'a' } });
    const communicationService: ICommunicationService = { ingest };

    const gateway = new GitHubGateway({
      communicationService,
      webhookSecret: SECRET,
      receiveMode: 'mentions',
      botLogin: 'ossmaintainer-ai[bot]',
    });

    const body = JSON.stringify(
      issueCommentPayload({
        comment: { id: 2, body: 'Just talking to myself here.', user: { id: 5150 } },
      })
    );

    const result = await gateway.handleWebhook(delivery(body));

    expect(result.status).toBe('ignored');
    expect(result.reason).toBe('not_mentioned');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('accepts every supported comment event in "all" mode, mentioned or not', async () => {
    const ingest = vi.fn().mockResolvedValue({ eventId: 'x', payload: { conversationId: 'c', actorId: 'a' } });
    const communicationService: ICommunicationService = { ingest };

    const gateway = new GitHubGateway({
      communicationService,
      webhookSecret: SECRET,
      receiveMode: 'all',
      botLogin: 'ossmaintainer-ai[bot]',
    });

    const body = JSON.stringify(
      issueCommentPayload({ comment: { id: 3, body: 'no mention here', user: { id: 5150 } } })
    );

    const result = await gateway.handleWebhook(delivery(body));

    expect(result.status).toBe('accepted');
    expect(ingest).toHaveBeenCalledOnce();
  });
});
