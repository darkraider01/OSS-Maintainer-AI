export type MissingIssueField =
  'reproduction_steps' | 'logs' | 'sdk_version' | 'operating_system' | 'environment_details';

export const ALL_ISSUE_FIELDS: readonly MissingIssueField[] = [
  'reproduction_steps',
  'logs',
  'sdk_version',
  'operating_system',
  'environment_details',
];

export const FIELD_PROMPTS: Record<MissingIssueField, string> = {
  reproduction_steps: 'Minimal steps to reproduce the issue',
  logs: 'Full error/log output (or a stack trace)',
  sdk_version: 'SDK/library version you are using',
  operating_system: 'Operating system (and version)',
  environment_details:
    'Other relevant environment details (runtime version, browser, container, etc.)',
};

export interface IssueTriageState {
  collectedFields: Partial<Record<MissingIssueField, string>>;
  turnCount: number;
  updatedAt: string;
}

export interface IssueTriageContext {
  conversationId: string;
  messageText: string;
  priorState: IssueTriageState | null;
}

export interface IssueTriageResult {
  isComplete: boolean;
  missingFields: MissingIssueField[];
  updatedFields: MissingIssueField[];
  state: IssueTriageState;
  responseText: string;
}
