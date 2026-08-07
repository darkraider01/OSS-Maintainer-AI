import { describe, expect, it } from 'vitest';
import { githubAdapter, parseGitHubReference } from '../../src/gateway/adapters/github.js';
import { fromEventRecord, fromSdkMessage } from '../../src/gateway/caspian/inbound-message.js';
import { inboundMessage, messageEvent } from '../helpers/fixtures.js';

describe('GitHub adapter', () => {
  it('normalizes a GitHub message into the Unified Event Model', () => {
    const event = githubAdapter.normalize(inboundMessage());

    expect(event.id).toBe('github:msg_1');
    expect(event.provider).toBe('github');
    expect(event.payloadType).toBe('issue_comment_created');
    expect(event.actorReference).toMatchObject({
      provider: 'github',
      providerActorId: '4242',
      handle: 'octocat',
      displayName: 'The Octocat',
    });
    expect(event.conversationReference).toMatchObject({
      conversationId: 'conv_1',
      connectionId: 'conn_1',
      messageId: 'msg_1',
    });
    expect(event.text).toBe('@oss-maintainer-ai please triage this');
  });

  it('detects pull-request comments from a permalink', () => {
    const message = inboundMessage({
      subject: null,
      text: 'Take a look at https://github.com/darkraider01/OSS-Maintainer-AI/pull/12',
    });

    const event = githubAdapter.normalize(message);
    expect(event.payloadType).toBe('pr_comment_created');
    expect(event.rawPayload.github_reference).toEqual({
      owner: 'darkraider01',
      repo: 'OSS-Maintainer-AI',
      number: 12,
      kind: 'pull_request',
    });
  });

  it('falls back to message_sent when no repository reference is present', () => {
    const event = githubAdapter.normalize(
      inboundMessage({ subject: 'hello', text: 'no reference here' })
    );

    expect(event.payloadType).toBe('message_sent');
    expect(event.rawPayload.github_reference).toBeNull();
  });

  it('preserves the original payload', () => {
    const message = inboundMessage({ raw: { id: 'msg_1', extra: 'kept' } });
    const event = githubAdapter.normalize(message);

    expect(event.rawPayload.extra).toBe('kept');
  });

  it('tolerates a sender with no recognizable identity fields', () => {
    const event = githubAdapter.normalize(inboundMessage({ sender: null }));

    expect(event.actorReference.handle).toBeNull();
    expect(event.actorReference.providerActorId).toBeNull();
  });
});

describe('parseGitHubReference', () => {
  it('reads the owner/repo#number shorthand', () => {
    expect(parseGitHubReference(inboundMessage())).toEqual({
      owner: 'darkraider01',
      repo: 'OSS-Maintainer-AI',
      number: 4,
      kind: 'issue',
    });
  });
});

describe('inbound message builders', () => {
  it('builds from a raw gateway event', () => {
    const message = fromEventRecord(messageEvent() as never);

    expect(message).not.toBeNull();
    expect(message?.channel).toBe('github');
    expect(message?.id).toBe('msg_1');
    expect(message?.customerId).toBe('cus_1');
  });

  it('ignores events that are not message.received', () => {
    expect(fromEventRecord(messageEvent({ type: 'reaction.received' }) as never)).toBeNull();
  });

  it('ignores malformed message payloads', () => {
    expect(fromEventRecord({ seq: 2, type: 'message.received', data: {} } as never)).toBeNull();
  });

  it('builds from an SDK message', () => {
    const sdkMessage = {
      id: 'msg_9',
      conversationId: 'conv_9',
      connectionId: 'conn_9',
      customerId: 'cus_9',
      agentId: 'agt_9',
      channel: 'github',
      sender: { login: 'octocat' },
      subject: null,
      text: 'hi',
      html: null,
      media: [],
    };

    const message = fromSdkMessage(sdkMessage as never);
    expect(message.id).toBe('msg_9');
    expect(message.raw.conversation_id).toBe('conv_9');
  });
});
