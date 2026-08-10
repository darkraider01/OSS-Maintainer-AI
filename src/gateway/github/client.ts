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

/** The slice of GitHub egress this app depends on — mockable in tests. */
export interface GitHubClientLike {
  postIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<GitHubComment>;
  getUserByLogin(login: string): Promise<GitHubUser | null>;
}

/** PEM keys are usually stored with escaped newlines in `.env`. */
function normalizePrivateKey(key: string): string {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
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
