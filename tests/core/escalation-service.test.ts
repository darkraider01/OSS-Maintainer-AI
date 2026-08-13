import { describe, expect, it } from 'vitest';
import { EscalationService } from '../../src/core/escalation/escalation-service.js';

describe('EscalationService', () => {
  const service = new EscalationService();

  it('escalates on a sensitive-topic (escalation_signal) intent regardless of confidence', () => {
    const decision = service.evaluate({
      intent: 'escalation_signal',
      confidence: 0.9,
      failureStreak: 0,
    });
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reason).toBe('sensitive_topic');
  });

  it('escalates on low confidence', () => {
    const decision = service.evaluate({ intent: 'general_qa', confidence: 0.3, failureStreak: 0 });
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reason).toBe('low_confidence');
  });

  it('escalates on repeated failure even at high confidence', () => {
    const decision = service.evaluate({ intent: 'general_qa', confidence: 0.9, failureStreak: 3 });
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reason).toBe('repeated_failure');
  });

  it('does not escalate a confident, non-sensitive, first-attempt message', () => {
    const decision = service.evaluate({ intent: 'bug_report', confidence: 0.8, failureStreak: 0 });
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.reason).toBeNull();
  });

  it('prioritizes sensitive_topic over repeated_failure when both apply', () => {
    const decision = service.evaluate({
      intent: 'escalation_signal',
      confidence: 0.9,
      failureStreak: 5,
    });
    expect(decision.reason).toBe('sensitive_topic');
  });
});
