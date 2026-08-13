import type { InboundMessage } from '../../src/gateway/caspian/inbound-message.js';
import type { CaspianClientLike } from '../../src/gateway/caspian-gateway.js';
import type {
  GitHubClientLike,
  GitHubUser,
  GitHubComment,
  ContributorActivity,
  RepositoryDoc,
  GoodFirstIssue,
  PullRequestFileChange,
  ReleaseNoteItem,
} from '../../src/gateway/github/client.js';

export function inboundMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  const base: InboundMessage = {
    id: 'msg_1',
    conversationId: 'conv_1',
    connectionId: 'conn_1',
    customerId: 'cus_1',
    agentId: 'agt_1',
    channel: 'github',
    sender: { id: '4242', login: 'octocat', display_name: 'The Octocat' },
    subject: 'darkraider01/OSS-Maintainer-AI#4',
    text: '@oss-maintainer-ai please triage this',
    html: null,
    raw: {},
  };
  return { ...base, ...overrides };
}

/** A `message.received` event exactly as the gateway delivers it. */
export function messageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt_1',
    seq: 1,
    type: 'message.received',
    data: {
      customer_id: 'cus_1',
      agent_id: 'agt_1',
      message: {
        id: 'msg_1',
        conversation_id: 'conv_1',
        connection_id: 'conn_1',
        channel: 'github',
        sender: { id: '4242', login: 'octocat' },
        subject: 'darkraider01/OSS-Maintainer-AI#4',
        text: '@oss-maintainer-ai please triage this',
        html: null,
        created_at: '2026-08-07T10:00:00.000Z',
      },
    },
    ...overrides,
  };
}

export interface FakeClient extends CaspianClientLike {
  replies: Array<{ messageId: string; text: string }>;
  handlers: Array<(message: any) => void | Promise<void>>;
  listenCalls: number;
}

/** Stand-in for `CommClient` — records replies so egress can be asserted. */
export function fakeClient(): FakeClient {
  const replies: FakeClient['replies'] = [];
  const handlers: FakeClient['handlers'] = [];

  return {
    replies,
    handlers,
    listenCalls: 0,
    onMessage(handler) {
      handlers.push(handler);
      return handler;
    },
    async reply(messageId: string, text?: string | null) {
      replies.push({ messageId, text: text ?? '' });
      return {};
    },
    async listen() {
      this.listenCalls += 1;
    },
  };
}

/* ------------------------------------------------------------------------
 * Realistic GitHub webhook fixtures (direct-webhook path, not Caspian).
 * ------------------------------------------------------------------------ */

export function githubRepository(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 100001,
    name: 'OSS-Maintainer-AI',
    full_name: 'darkraider01/OSS-Maintainer-AI',
    owner: { login: 'darkraider01', id: 7000, type: 'User' },
    ...overrides,
  };
}

export function githubSender(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 4242,
    login: 'octocat',
    avatar_url: 'https://avatars.githubusercontent.com/u/4242',
    type: 'User',
    ...overrides,
  };
}

export function githubBotSender(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 99999,
    login: 'oss-maintainer-ai[bot]',
    avatar_url: 'https://avatars.githubusercontent.com/in/99999',
    type: 'Bot',
    ...overrides,
  };
}

export function issuesOpenedPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    action: 'opened',
    issue: {
      id: 555001,
      number: 42,
      title: 'The build fails on Windows',
      body: 'Steps to reproduce:\n1. `pnpm install`\n2. `pnpm build`\n\ncc @maintainer-bot',
      html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/issues/42',
      created_at: '2026-08-10T10:00:00Z',
      user: githubSender(),
    },
    repository: githubRepository(),
    sender: githubSender(),
    ...overrides,
  };
}

export function issueCommentPayload(
  overrides: Record<string, unknown> = {},
  options: { onPullRequest?: boolean } = {}
): Record<string, unknown> {
  const issue: Record<string, unknown> = {
    id: 555001,
    number: 42,
    title: 'The build fails on Windows',
    html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/issues/42',
    user: githubSender(),
  };
  if (options.onPullRequest) {
    issue.pull_request = {
      url: 'https://api.github.com/repos/darkraider01/OSS-Maintainer-AI/pulls/42',
      html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/pull/42',
    };
  }
  return {
    action: 'created',
    issue,
    comment: {
      id: 900001,
      body: 'Thanks for the report — can you share the full error output?',
      html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/issues/42#issuecomment-900001',
      created_at: '2026-08-10T10:05:00Z',
      user: githubSender({ id: 5150, login: 'contributor-two' }),
    },
    repository: githubRepository(),
    sender: githubSender({ id: 5150, login: 'contributor-two' }),
    ...overrides,
  };
}

export function pullRequestOpenedPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    action: 'opened',
    pull_request: {
      id: 777001,
      number: 77,
      title: 'Fix Windows build path handling',
      body: 'This PR fixes the path separator bug on Windows. @darkraider01 please review.',
      html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/pull/77',
      created_at: '2026-08-10T11:00:00Z',
      user: githubSender({ id: 6100, login: 'contributor-three' }),
    },
    repository: githubRepository(),
    sender: githubSender({ id: 6100, login: 'contributor-three' }),
    ...overrides,
  };
}

export function pullRequestReviewPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    action: 'submitted',
    pull_request: {
      id: 777001,
      number: 77,
      title: 'Fix Windows build path handling',
      html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/pull/77',
      user: githubSender({ id: 6100, login: 'contributor-three' }),
    },
    review: {
      id: 300001,
      body: 'Looks good overall, one nit on the path join helper.',
      html_url:
        'https://github.com/darkraider01/OSS-Maintainer-AI/pull/77#pullrequestreview-300001',
      submitted_at: '2026-08-10T11:30:00Z',
      user: githubSender({ id: 7000, login: 'darkraider01' }),
    },
    repository: githubRepository(),
    sender: githubSender({ id: 7000, login: 'darkraider01' }),
    ...overrides,
  };
}

export function pullRequestReviewCommentPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    action: 'created',
    pull_request: {
      id: 777001,
      number: 77,
      title: 'Fix Windows build path handling',
      html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/pull/77',
      user: githubSender({ id: 6100, login: 'contributor-three' }),
    },
    comment: {
      id: 400001,
      body: 'Use `path.join` here instead of string concatenation.',
      html_url: 'https://github.com/darkraider01/OSS-Maintainer-AI/pull/77#discussion_r400001',
      created_at: '2026-08-10T11:35:00Z',
      user: githubSender({ id: 7000, login: 'darkraider01' }),
    },
    repository: githubRepository(),
    sender: githubSender({ id: 7000, login: 'darkraider01' }),
    ...overrides,
  };
}

export interface FakeGitHubClient extends GitHubClientLike {
  comments: Array<{ owner: string; repo: string; issueNumber: number; body: string }>;
}

/** Stand-in for `GitHubAppClient` — records posted comments, resolves seeded users. */
export function fakeGitHubClient(
  users: GitHubUser[] = [],
  options: {
    activity?: Record<string, ContributorActivity>;
    docs?: RepositoryDoc[];
    goodFirstIssues?: GoodFirstIssue[];
    pullRequestFiles?: PullRequestFileChange[];
    mergedPullRequests?: ReleaseNoteItem[];
    closedIssues?: ReleaseNoteItem[];
  } = {}
): FakeGitHubClient {
  const comments: FakeGitHubClient['comments'] = [];
  const userMap = new Map(users.map((u) => [u.login.toLowerCase(), u]));
  let nextCommentId = 1;

  return {
    comments,
    async postIssueComment(owner, repo, issueNumber, body) {
      comments.push({ owner, repo, issueNumber, body });
      const id = nextCommentId++;
      const comment: GitHubComment = {
        id,
        htmlUrl: `https://github.com/${owner}/${repo}/issues/${issueNumber}#issuecomment-${id}`,
      };
      return comment;
    },
    async getUserByLogin(login) {
      return userMap.get(login.toLowerCase()) ?? null;
    },
    async listContributorActivity(_owner, _repo, login) {
      return options.activity?.[login.toLowerCase()] ?? { issuesOpened: 0, pullRequestsOpened: 0 };
    },
    async getRepositoryDocs() {
      return options.docs ?? [];
    },
    async listGoodFirstIssues() {
      return options.goodFirstIssues ?? [];
    },
    async listPullRequestFiles() {
      return options.pullRequestFiles ?? [];
    },
    async listMergedPullRequests() {
      return options.mergedPullRequests ?? [];
    },
    async listClosedIssues() {
      return options.closedIssues ?? [];
    },
  };
}
