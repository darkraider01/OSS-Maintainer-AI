import { describe, expect, it } from 'vitest';
import { DefaultEscalationWorkflow } from '../../src/core/workflow/workflows/escalation-workflow.js';
import type { AgentContext } from '../../src/core/agent/agent-types.js';
import type { IntentClassificationResult } from '../../src/core/intent/intent-types.js';
import type { EscalationDecision } from '../../src/core/escalation/escalation-types.js';

function fakeContext(provider: 'github' | 'slack' | 'discord'): AgentContext {
  return {
    event: { provider, conversationId: 'c1', actorId: 'a1' },
  } as AgentContext;
}

const classification: IntentClassificationResult = {
  intent: 'escalation_signal',
  confidence: 0.9,
  signals: [],
};

const decision: EscalationDecision = {
  shouldEscalate: true,
  reason: 'sensitive_topic',
  confidence: 0.9,
  attempts: 0,
};

describe('DefaultEscalationWorkflow', () => {
  it('includes the configured maintainer mention in the reply for that provider', async () => {
    const workflow = new DefaultEscalationWorkflow({ github: 'darkraider01' });
    const response = await workflow.execute(fakeContext('github'), classification, decision);

    expect(response.text).toContain('@darkraider01');
    expect(response.metadata.maintainerNotified).toBe(true);
  });

  it('omits any mention when the provider has none configured, without erroring', async () => {
    const workflow = new DefaultEscalationWorkflow({ slack: '<@U123>' }); // github not configured
    const response = await workflow.execute(fakeContext('github'), classification, decision);

    expect(response.text).not.toContain('@');
    expect(response.metadata.maintainerNotified).toBe(false);
  });

  it('defaults to no mentions configured at all (backward compatible)', async () => {
    const workflow = new DefaultEscalationWorkflow();
    const response = await workflow.execute(fakeContext('slack'), classification, decision);
    expect(response.metadata.maintainerNotified).toBe(false);
  });

  it('always marks the conversation escalated regardless of mention configuration', async () => {
    const workflow = new DefaultEscalationWorkflow({ discord: '<@999>' });
    const response = await workflow.execute(fakeContext('discord'), classification, decision);
    expect(response.metadata.escalated).toBe(true);
    expect(response.metadata.escalationReason).toBe('sensitive_topic');
    expect(response.text).toContain('<@999>');
  });
});
