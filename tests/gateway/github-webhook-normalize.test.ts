import { describe, expect, it } from 'vitest';
import {
  extractMentions,
  isSupportedGitHubWebhookEvent,
  normalizeGitHubWebhookEvent,
} from '../../src/gateway/adapters/github.js';
import {
  issuesOpenedPayload,
  issueCommentPayload,
  pullRequestOpenedPayload,
  pullRequestReviewPayload,
  pullRequestReviewCommentPayload,
} from '../helpers/fixtures.js';

describe('GitHub webhook normalization', () => {
  it('normalizes issues.opened into the CommunicationService-shaped message', () => {
    const result = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: 'delivery-1',
      payload: issuesOpenedPayload(),
    });

    expect(result).not.toBeNull();
    expect(result!.rawMessage).toMatchObject({
      id: 'delivery-1',
      channel: 'issue',
      conversationId: 'darkraider01/OSS-Maintainer-AI#42',
      subject: 'The build fails on Windows',
      eventType: 'THREAD_CREATED',
      messageType: 'text',
    });
    expect((result!.rawMessage.sender as any).id).toBe(4242);
    expect((result!.rawMessage.sender as any).login).toBe('octocat');
    expect(result!.rawMessage.repositoryContext).toMatchObject({
      provider: 'github',
      owner: 'darkraider01',
      repositoryName: 'OSS-Maintainer-AI',
    });
    const github = (result!.rawMessage.metadata as any).github;
    expect(github.owner).toBe('darkraider01');
    expect(github.repo).toBe('OSS-Maintainer-AI');
    expect(github.issueNumber).toBe(42);
    expect(github.kind).toBe('issue');
    // Original GitHub payload is preserved, not discarded.
    expect(github.payload.issue.number).toBe(42);
  });

  it('normalizes issue_comment.created on an issue', () => {
    const result = normalizeGitHubWebhookEvent({
      eventName: 'issue_comment',
      deliveryId: 'delivery-2',
      payload: issueCommentPayload(),
    });

    expect(result).not.toBeNull();
    expect(result!.rawMessage.channel).toBe('issue');
    expect(result!.rawMessage.conversationId).toBe('darkraider01/OSS-Maintainer-AI#42');
    expect(result!.rawMessage.text).toBe(
      'Thanks for the report — can you share the full error output?'
    );
    expect(result!.rawMessage.eventType).toBe('MESSAGE_CREATED');
    expect((result!.rawMessage.sender as any).login).toBe('contributor-two');
  });

  it('carries the parent issue title/body into repositoryContext, distinct from the comment text', () => {
    // Regression: a comment on an existing issue previously had no way to
    // know what that issue was actually about (the LLM only ever saw the
    // comment text) — this is what wires the issue's own description
    // through to the prompt.
    const result = normalizeGitHubWebhookEvent({
      eventName: 'issue_comment',
      deliveryId: 'delivery-2c',
      payload: issueCommentPayload(),
    });

    expect(result).not.toBeNull();
    const repositoryContext = result!.rawMessage.repositoryContext as any;
    expect(repositoryContext.issueTitle).toBe('The build fails on Windows');
    expect(repositoryContext.issueBody).toBe(
      'Steps to reproduce:\n1. `pnpm install`\n2. `pnpm build`\n\ncc @maintainer-bot'
    );
    // The comment's own text is untouched and still distinct from the issue body.
    expect(result!.rawMessage.text).toBe(
      'Thanks for the report — can you share the full error output?'
    );
  });

  it('leaves issueBody unset for a freshly-opened issue, where text already is the description', () => {
    const result = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: 'delivery-1b',
      payload: issuesOpenedPayload(),
    });

    expect(result).not.toBeNull();
    const repositoryContext = result!.rawMessage.repositoryContext as any;
    expect(repositoryContext.issueTitle).toBe('The build fails on Windows');
    expect(repositoryContext.issueBody).toBeUndefined();
  });

  it('normalizes issue_comment.created on a pull request as a pull_request conversation', () => {
    const result = normalizeGitHubWebhookEvent({
      eventName: 'issue_comment',
      deliveryId: 'delivery-2b',
      payload: issueCommentPayload({}, { onPullRequest: true }),
    });

    expect(result).not.toBeNull();
    expect(result!.rawMessage.channel).toBe('pull_request');
    expect(result!.kind).toBe('pull_request');
  });

  it('normalizes pull_request.opened', () => {
    const result = normalizeGitHubWebhookEvent({
      eventName: 'pull_request',
      deliveryId: 'delivery-3',
      payload: pullRequestOpenedPayload(),
    });

    expect(result).not.toBeNull();
    expect(result!.rawMessage.channel).toBe('pull_request');
    expect(result!.rawMessage.conversationId).toBe('darkraider01/OSS-Maintainer-AI#77');
    expect(result!.rawMessage.eventType).toBe('THREAD_CREATED');
    expect(result!.rawMessage.subject).toBe('Fix Windows build path handling');
  });

  it('normalizes pull_request_review.submitted', () => {
    const result = normalizeGitHubWebhookEvent({
      eventName: 'pull_request_review',
      deliveryId: 'delivery-4',
      payload: pullRequestReviewPayload(),
    });

    expect(result).not.toBeNull();
    expect(result!.rawMessage.channel).toBe('pull_request');
    expect(result!.rawMessage.conversationId).toBe('darkraider01/OSS-Maintainer-AI#77');
    expect(result!.rawMessage.text).toBe('Looks good overall, one nit on the path join helper.');
  });

  it('normalizes pull_request_review_comment.created, including in-reply-to threading', () => {
    const result = normalizeGitHubWebhookEvent({
      eventName: 'pull_request_review_comment',
      deliveryId: 'delivery-5',
      payload: pullRequestReviewCommentPayload({
        comment: {
          id: 400002,
          body: 'Agreed, updating.',
          html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/pull/77#discussion_r400002',
          created_at: '2026-08-10T11:40:00Z',
          user: { id: 6100, login: 'contributor-three' },
          in_reply_to_id: 400001,
        },
      }),
    });

    expect(result).not.toBeNull();
    expect(result!.rawMessage.channel).toBe('pull_request');
    expect(result!.rawMessage.replyToId).toBe('400001');
  });

  it('extracts @-mentions from GitHub markdown text, de-duplicated', () => {
    const mentions = extractMentions('cc @maintainer-bot and also @maintainer-bot, thanks @octocat');
    expect(mentions).toEqual([
      { providerUserId: 'maintainer-bot', displayName: 'maintainer-bot', provider: 'github' },
      { providerUserId: 'octocat', displayName: 'octocat', provider: 'github' },
    ]);
  });

  it('returns no mentions for null/empty text', () => {
    expect(extractMentions(null)).toEqual([]);
    expect(extractMentions('')).toEqual([]);
  });

  it('ignores unsupported event/action combinations', () => {
    expect(isSupportedGitHubWebhookEvent('issues', 'closed')).toBe(false);
    expect(isSupportedGitHubWebhookEvent('star', 'created')).toBe(false);
    expect(isSupportedGitHubWebhookEvent('issues', 'opened')).toBe(true);

    const result = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: 'delivery-6',
      payload: issuesOpenedPayload({ action: 'closed' }),
    });
    expect(result).toBeNull();
  });

  it('ignores payloads missing repository or issue/PR context', () => {
    const result = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: 'delivery-7',
      payload: { action: 'opened' },
    });
    expect(result).toBeNull();
  });
});
