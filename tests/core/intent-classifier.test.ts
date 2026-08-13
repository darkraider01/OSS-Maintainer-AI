import { describe, expect, it } from 'vitest';
import { RuleBasedIntentClassifier } from '../../src/core/intent/intent-classifier.js';

describe('RuleBasedIntentClassifier', () => {
  const classifier = new RuleBasedIntentClassifier();

  it('classifies a bug report', async () => {
    const result = await classifier.classify('The SDK crashes when I call connect().');
    expect(result.intent).toBe('bug_report');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies a contribution question', async () => {
    const result = await classifier.classify('How can I start contributing to this project?');
    expect(result.intent).toBe('contribution_question');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies an explicit PR summary request', async () => {
    const result = await classifier.classify('Can you summarize this PR for me?');
    expect(result.intent).toBe('pr_summary_request');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies a sensitive-topic message as an escalation signal, overriding other matches', async () => {
    const result = await classifier.classify(
      'I found a security vulnerability that also crashes the SDK — please escalate this.'
    );
    expect(result.intent).toBe('escalation_signal');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('classifies an explicit request for a human as an escalation signal', async () => {
    const result = await classifier.classify('Can I talk to a human please?');
    expect(result.intent).toBe('escalation_signal');
  });

  it('falls back to general_qa with solid confidence for a plain question', async () => {
    const result = await classifier.classify('What does this configuration option do?');
    expect(result.intent).toBe('general_qa');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('treats null text as general_qa without throwing', async () => {
    const result = await classifier.classify(null);
    expect(result.intent).toBe('general_qa');
  });

  it('lowers confidence when a message plausibly matches more than one category', async () => {
    const result = await classifier.classify(
      "It's broken when I try to contribute — how do I start contributing and also fix this bug?"
    );
    expect(result.confidence).toBeLessThan(0.5);
  });
});
