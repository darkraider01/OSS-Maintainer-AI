import {
  ALL_ISSUE_FIELDS,
  FIELD_PROMPTS,
  type IssueTriageContext,
  type IssueTriageResult,
  type IssueTriageState,
  type MissingIssueField,
} from './issue-triage-types.js';

const OS_PATTERNS: RegExp[] = [
  /\b(ubuntu|debian|fedora|centos|alpine|arch\s?linux|linux mint)\s*[\d.]*/i,
  /\b(windows)\s*(?:server\s*)?\d{1,2}(?:\.\d+)?/i,
  /\b(macos|mac os(?:\s*x)?|os x)\s*[\d.]*/i,
  /\b(linux)\b/i,
];

const SDK_VERSION_PATTERNS: RegExp[] = [
  /\bsdk\s*(?:version)?\s*[:=]?\s*v?(\d+\.\d+(?:\.\d+)?)/i,
  /\bversion\s*[:=]?\s*v?(\d+\.\d+(?:\.\d+)?)/i,
  /\bv(\d+\.\d+\.\d+)\b/,
];

const LOG_SIGNALS: RegExp[] = [
  /```/,
  /\btraceback\b/i,
  /\bstack trace\b/i,
  /\berror:/i,
  /\bexception\b/i,
  /at\s+\S+\s*\(.*:\d+:\d+\)/,
];

const REPRO_SIGNALS: RegExp[] = [
  /steps to reproduce/i,
  /to reproduce/i,
  /when i (call|run|use|click|open)/i,
  /^\s*\d+[.)]\s+.+/m,
];

const ENV_SIGNALS: RegExp[] = [
  /\bnode\s*v?\d+/i,
  /\bnpm\s*v?\d+/i,
  /\b(chrome|firefox|safari|edge)\b/i,
  /\bdocker\b/i,
  /\bcontainer\b/i,
  /\benvironment\s*[:=]/i,
];

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim().slice(0, 200);
  }
  return null;
}

function extractFields(text: string): Partial<Record<MissingIssueField, string>> {
  const extracted: Partial<Record<MissingIssueField, string>> = {};
  const os = firstMatch(text, OS_PATTERNS);
  if (os) extracted.operating_system = os;
  const sdk = firstMatch(text, SDK_VERSION_PATTERNS);
  if (sdk) extracted.sdk_version = sdk;
  if (LOG_SIGNALS.some((p) => p.test(text))) extracted.logs = 'provided';
  if (REPRO_SIGNALS.some((p) => p.test(text))) extracted.reproduction_steps = 'provided';
  const env = firstMatch(text, ENV_SIGNALS);
  if (env) extracted.environment_details = env;
  return extracted;
}

/**
 * Multi-turn missing-field collection for bug reports. Heuristic
 * (regex-based) extraction, not LLM function-calling — deliberately, so
 * required fields are represented structurally per PRD §7 rather than left
 * to prompt-only reasoning. Pure function: takes/returns state, no DB or LLM
 * access, so WorkflowEngine owns persistence and this stays unit-testable.
 */
export class IssueTriageService {
  process(context: IssueTriageContext): IssueTriageResult {
    const priorFields = context.priorState?.collectedFields ?? {};
    const newlyExtracted = extractFields(context.messageText ?? '');

    const updatedFields: MissingIssueField[] = [];
    const collectedFields: Partial<Record<MissingIssueField, string>> = { ...priorFields };
    for (const field of ALL_ISSUE_FIELDS) {
      const newValue = newlyExtracted[field];
      if (newValue && newValue !== collectedFields[field]) {
        collectedFields[field] = newValue;
        updatedFields.push(field);
      }
    }

    const missingFields = ALL_ISSUE_FIELDS.filter((field) => !collectedFields[field]);
    const isComplete = missingFields.length === 0;

    const state: IssueTriageState = {
      collectedFields,
      turnCount: (context.priorState?.turnCount ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };

    return {
      isComplete,
      missingFields,
      updatedFields,
      state,
      responseText: this.buildResponseText({
        isComplete,
        missingFields,
        updatedFields,
        state,
        collectedFields,
      }),
    };
  }

  private buildResponseText(params: {
    isComplete: boolean;
    missingFields: MissingIssueField[];
    updatedFields: MissingIssueField[];
    state: IssueTriageState;
    collectedFields: Partial<Record<MissingIssueField, string>>;
  }): string {
    const { isComplete, missingFields, updatedFields, state, collectedFields } = params;

    if (isComplete) {
      const summary = ALL_ISSUE_FIELDS.map(
        (field) => `- ${FIELD_PROMPTS[field]}: ${collectedFields[field]}`
      ).join('\n');
      return [
        'Thanks — I have everything needed to prepare this issue.',
        '',
        summary,
        '',
        "Reply to confirm and a maintainer will open the issue with this information (I won't create it automatically).",
      ].join('\n');
    }

    const questions = missingFields
      .map((field, i) => `${i + 1}. ${FIELD_PROMPTS[field]}`)
      .join('\n');

    const intro =
      state.turnCount <= 1
        ? 'I can help triage this. Could you provide:'
        : updatedFields.length > 0
          ? 'Thanks — got that. I still need:'
          : 'I still need a bit more to triage this. Could you provide:';

    return [intro, questions].join('\n');
  }
}
