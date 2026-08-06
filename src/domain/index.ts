/**
 * Core Domain concepts representing system entities.
 * Keep intentionally minimal until implementation demands structure.
 */

export interface Repository {
  id: string;
  owner: string;
  name: string;
  url: string;
}

export interface Contributor {
  id: string;
  username: string;
  avatarUrl: string;
}

export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  author: Contributor;
  repository: Repository;
}

export interface PullRequest extends Issue {
  draft: boolean;
  merged: boolean;
  baseBranch: string;
  headBranch: string;
}

export interface Comment {
  id: string;
  body: string;
  author: Contributor;
  createdAt: string;
}

export interface Review {
  id: string;
  pullRequestNumber: number;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
  body: string;
  comments: Comment[];
}

export interface AgentContext {
  conversationId: string;
  platform: 'email' | 'slack' | 'discord' | 'telegram' | 'github';
  sender: Contributor;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export interface ExecutionState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  currentStep?: string;
  errors?: Error[];
}

// Small documentation update to prompt PR commit changes
export const DOMAIN_VERSION = '1.0.0';
