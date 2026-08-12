import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface GitHubUser {
  id: number;
  login: string;
  avatarUrl: string | null;
}

export interface GitHubComment {
  id: number;
  htmlUrl: string;
}

export interface ContributorActivity {
  issuesOpened: number;
  pullRequestsOpened: number;
}

export interface RepositoryDoc {
  path: string;
  content: string;
}

/** The slice of GitHub egress this app depends on — mockable in tests. */
export interface GitHubClientLike {
  postIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<GitHubComment>;
  getUserByLogin(login: string): Promise<GitHubUser | null>;
  listContributorActivity(owner: string, repo: string, login: string): Promise<ContributorActivity>;
  getRepositoryDocs(owner: string, repo: string): Promise<RepositoryDoc[]>;
}

/** PEM keys are usually stored with escaped newlines in `.env`. */
function normalizePrivateKey(key: string): string {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

function decodeBase64Content(content: string): string {
  return Buffer.from(content, 'base64').toString('utf-8');
}

/**
 * GitHub App-authenticated client (JWT + installation token exchange handled
 * by `@octokit/auth-app`). This is the only way this app talks to the GitHub
 * REST API — no PAT, no hardcoded tokens.
 */
export class GitHubAppClient implements GitHubClientLike {
  private readonly octokit: Octokit;

  constructor(options: { appId: string; privateKey: string; installationId: string }) {
    this.octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: options.appId,
        privateKey: normalizePrivateKey(options.privateKey),
        installationId: options.installationId,
      },
    });
  }

  /** Posts a comment on an issue or pull request — GitHub uses the Issues API for both. */
  async postIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<GitHubComment> {
    const { data } = await this.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return { id: data.id, htmlUrl: data.html_url };
  }

  async getUserByLogin(login: string): Promise<GitHubUser | null> {
    try {
      const { data } = await this.octokit.rest.users.getByUsername({ username: login });
      return { id: data.id, login: data.login, avatarUrl: data.avatar_url ?? null };
    } catch (error) {
      logger.warn({ err: error, login }, 'Failed to resolve GitHub user by login');
      return null;
    }
  }

  /** Issue/PR counts authored by `login` in this repo, via the Search API (count-only, per_page=1). */
  async listContributorActivity(
    owner: string,
    repo: string,
    login: string
  ): Promise<ContributorActivity> {
    const [issues, pulls] = await Promise.all([
      this.octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} type:issue author:${login}`,
        per_page: 1,
      }),
      this.octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} type:pr author:${login}`,
        per_page: 1,
      }),
    ]);
    return {
      issuesOpened: issues.data.total_count,
      pullRequestsOpened: pulls.data.total_count,
    };
  }

  /**
   * README plus every `.md`/`.mdx`/`.txt` file directly under `/docs` (one level,
   * no recursive walk). Deliberately does not fetch the wiki — GitHub wikis are a
   * separate git repo, not reachable via this Contents API. Missing README or
   * missing `/docs` directory are not errors, just an empty contribution.
   */
  async getRepositoryDocs(owner: string, repo: string): Promise<RepositoryDoc[]> {
    const docs: RepositoryDoc[] = [];

    try {
      const { data: readme } = await this.octokit.rest.repos.getReadme({ owner, repo });
      docs.push({ path: readme.path, content: decodeBase64Content(readme.content) });
    } catch (error) {
      logger.debug({ err: error, owner, repo }, 'No README found');
    }

    try {
      const { data: contents } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: 'docs',
      });
      const entries = Array.isArray(contents) ? contents : [contents];
      for (const entry of entries) {
        if (entry.type !== 'file' || !/\.(md|mdx|txt)$/i.test(entry.name)) continue;
        const { data: file } = await this.octokit.rest.repos.getContent({
          owner,
          repo,
          path: entry.path,
        });
        if (!Array.isArray(file) && file.type === 'file' && file.content) {
          docs.push({ path: file.path, content: decodeBase64Content(file.content) });
        }
      }
    } catch (error) {
      logger.debug({ err: error, owner, repo }, 'No /docs directory found');
    }

    return docs;
  }
}

let cachedClient: GitHubAppClient | null = null;

export function hasGitHubAppCredentials(): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY && env.GITHUB_INSTALLATION_ID);
}

/** Lazily builds the singleton GitHub App client. Never logs the private key or tokens. */
export function createGitHubAppClient(): GitHubAppClient {
  if (cachedClient) return cachedClient;
  if (!hasGitHubAppCredentials()) {
    throw new Error(
      'GitHub App credentials missing: GITHUB_APP_ID, GITHUB_PRIVATE_KEY, and GITHUB_INSTALLATION_ID are required'
    );
  }
  cachedClient = new GitHubAppClient({
    appId: env.GITHUB_APP_ID as string,
    privateKey: env.GITHUB_PRIVATE_KEY as string,
    installationId: env.GITHUB_INSTALLATION_ID as string,
  });
  logger.info({ appId: env.GITHUB_APP_ID }, 'GitHub App client initialized');
  return cachedClient;
}
