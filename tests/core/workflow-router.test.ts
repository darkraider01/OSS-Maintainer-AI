import { describe, expect, it } from 'vitest';
import { WorkflowRouter } from '../../src/core/workflow/workflow-router.js';
import { GeneralWorkflow } from '../../src/core/workflow/workflows/general-workflow.js';
import { TriageWorkflow } from '../../src/core/workflow/workflows/triage-workflow.js';
import { DefaultEscalationWorkflow } from '../../src/core/workflow/workflows/escalation-workflow.js';

describe('WorkflowRouter', () => {
  it('routes a registered intent to its workflow', () => {
    const router = new WorkflowRouter(new DefaultEscalationWorkflow());
    const general = new GeneralWorkflow();
    const triage = new TriageWorkflow();
    router.register('general_qa', general);
    router.register('bug_report', triage);

    expect(router.route('bug_report')).toBe(triage);
    expect(router.route('general_qa')).toBe(general);
  });

  it('falls back to the general_qa workflow for an unregistered intent', () => {
    const router = new WorkflowRouter(new DefaultEscalationWorkflow());
    const general = new GeneralWorkflow();
    router.register('general_qa', general);

    expect(router.route('contribution_question')).toBe(general);
  });

  it('throws if no general_qa fallback is registered', () => {
    const router = new WorkflowRouter(new DefaultEscalationWorkflow());
    expect(() => router.route('bug_report')).toThrow();
  });
});
