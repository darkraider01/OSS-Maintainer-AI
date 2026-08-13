import { describe, expect, it } from 'vitest';
import { IssueTriageService } from '../../src/core/triage/issue-triage-service.js';

describe('IssueTriageService', () => {
  const service = new IssueTriageService();

  it('asks for missing fields on the first turn', () => {
    const result = service.process({
      conversationId: 'c1',
      messageText: 'The SDK crashes when I call connect().',
      priorState: null,
    });

    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('sdk_version');
    expect(result.missingFields).toContain('operating_system');
    expect(result.responseText).toContain('Could you provide');
    expect(result.state.turnCount).toBe(1);
  });

  it('completes across multiple turns, tracking state', () => {
    const turn1 = service.process({
      conversationId: 'c2',
      messageText: 'The SDK crashes when I call connect(). Steps to reproduce: 1. install 2. run',
      priorState: null,
    });
    expect(turn1.isComplete).toBe(false);

    const turn2 = service.process({
      conversationId: 'c2',
      messageText:
        'SDK version 2.1.0, running on Ubuntu 24.04, node v20. Error: Connection refused\n```\nTraceback...\n```',
      priorState: turn1.state,
    });

    expect(turn2.isComplete).toBe(true);
    expect(turn2.missingFields).toHaveLength(0);
    expect(turn2.state.turnCount).toBe(2);
    expect(turn2.responseText).toContain('everything needed');
  });

  it('does not create an issue automatically — only proposes one via metadata/actions upstream', () => {
    const result = service.process({
      conversationId: 'c3',
      messageText:
        'SDK 2.1.0 on Windows 11, node v20, browser Chrome. Steps to reproduce: 1. open 2. click. Error: boom\n```stack```',
      priorState: null,
    });
    expect(result.isComplete).toBe(true);
    expect(result.responseText).toMatch(/won'?t create it automatically|reply to confirm/i);
  });

  it('updates a field when the contributor provides conflicting information later', () => {
    const turn1 = service.process({
      conversationId: 'c4',
      messageText: 'Running on Ubuntu 24.04.',
      priorState: null,
    });
    expect(turn1.state.collectedFields.operating_system).toMatch(/ubuntu/i);

    const turn2 = service.process({
      conversationId: 'c4',
      messageText: 'Correction — it is actually Windows 11.',
      priorState: turn1.state,
    });
    expect(turn2.state.collectedFields.operating_system).toMatch(/windows/i);
    expect(turn2.updatedFields).toContain('operating_system');
  });

  it('handles malformed/empty input without throwing', () => {
    const result = service.process({ conversationId: 'c5', messageText: '', priorState: null });
    expect(result.isComplete).toBe(false);
    expect(result.missingFields.length).toBeGreaterThan(0);
  });

  it('persists and resumes state across separate process() calls (conversation persistence)', () => {
    const turn1 = service.process({
      conversationId: 'c6',
      messageText: 'SDK 3.0.0',
      priorState: null,
    });
    // Simulate reloading state from storage between turns.
    const reloadedState = JSON.parse(JSON.stringify(turn1.state));
    const turn2 = service.process({
      conversationId: 'c6',
      messageText: 'Ubuntu 22.04',
      priorState: reloadedState,
    });
    expect(turn2.state.collectedFields.sdk_version).toBe(turn1.state.collectedFields.sdk_version);
    expect(turn2.state.collectedFields.operating_system).toBeDefined();
  });
});
