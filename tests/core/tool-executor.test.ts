import { describe, expect, it, vi } from 'vitest';
import { ToolExecutor } from '../../src/core/tools/tool-executor.js';
import { ToolRegistry } from '../../src/core/tools/tool-registry.js';
import type { Tool, AgentContext } from '../../src/core/agent/agent-types.js';
import type { LLMProvider } from '../../src/core/llm/llm-provider.js';

function fakeContext(): AgentContext {
  return {} as AgentContext; // ToolExecutor only threads this through to tool.execute(), doesn't read it itself
}

describe('ToolExecutor', () => {
  it('answers directly when the model requests no tool calls', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'noop',
      description: 'd',
      parameters: {},
      execute: async () => ({}),
    });

    const llm: LLMProvider = {
      name: 'fake',
      supportsTools: () => true,
      supportsVision: () => false,
      supportsReasoning: () => false,
      generate: vi.fn(),
      generateWithTools: vi.fn().mockResolvedValue({ text: 'direct answer', toolCalls: [] }),
      embed: vi.fn(),
    };

    const result = await new ToolExecutor(registry).run({
      llm,
      systemPrompt: 's',
      userPrompt: 'u',
      toolContext: fakeContext(),
    });

    expect(result.text).toBe('direct answer');
    expect(result.toolCallLog).toHaveLength(0);
    expect(llm.generateWithTools).toHaveBeenCalledOnce();
  });

  it('executes a requested tool and asks again with tools disabled for the final answer', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn().mockResolvedValue({ found: 'doc content' });
    registry.register({ name: 'search_documentation', description: 'd', parameters: {}, execute });

    const generateWithTools = vi
      .fn()
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [{ name: 'search_documentation', arguments: { query: 'q' } }],
      })
      .mockResolvedValueOnce({ text: 'final grounded answer', toolCalls: [] });

    const llm: LLMProvider = {
      name: 'fake',
      supportsTools: () => true,
      supportsVision: () => false,
      supportsReasoning: () => false,
      generate: vi.fn(),
      generateWithTools,
      embed: vi.fn(),
    };

    const result = await new ToolExecutor(registry).run({
      llm,
      systemPrompt: 's',
      userPrompt: 'u',
      toolContext: fakeContext(),
    });

    expect(execute).toHaveBeenCalledWith({ query: 'q' }, expect.anything());
    expect(result.text).toBe('final grounded answer');
    expect(result.toolCallLog).toEqual([
      { name: 'search_documentation', arguments: { query: 'q' }, result: { found: 'doc content' } },
    ]);
    expect(generateWithTools).toHaveBeenCalledTimes(2);
    // Second call must disable tools so the model is forced to answer.
    expect(generateWithTools.mock.calls[1][2]).toEqual([]);
  });

  it('records an error result for a tool name the model hallucinated', async () => {
    const registry = new ToolRegistry();
    // A real tool must be registered so the executor actually enters the
    // tool-calling path (tools.length > 0) — the model then asks for a
    // *different*, nonexistent name, which is the scenario under test.
    registry.register({
      name: 'search_documentation',
      description: 'd',
      parameters: {},
      execute: async () => ({}),
    });

    const generateWithTools = vi
      .fn()
      .mockResolvedValueOnce({ text: null, toolCalls: [{ name: 'does_not_exist', arguments: {} }] })
      .mockResolvedValueOnce({ text: 'answered anyway', toolCalls: [] });

    const llm: LLMProvider = {
      name: 'fake',
      supportsTools: () => true,
      supportsVision: () => false,
      supportsReasoning: () => false,
      generate: vi.fn(),
      generateWithTools,
      embed: vi.fn(),
    };

    const result = await new ToolExecutor(registry).run({
      llm,
      systemPrompt: 's',
      userPrompt: 'u',
      toolContext: fakeContext(),
    });

    expect(result.toolCallLog[0].result).toEqual({ error: 'Unknown tool: does_not_exist' });
    expect(result.text).toBe('answered anyway');
  });

  it('falls back to plain generate() when the provider does not support tools', async () => {
    const registry = new ToolRegistry();
    registry.register({ name: 'x', description: 'd', parameters: {}, execute: async () => ({}) });

    const llm: LLMProvider = {
      name: 'fake',
      supportsTools: () => false,
      supportsVision: () => false,
      supportsReasoning: () => false,
      generate: vi.fn().mockResolvedValue({ text: 'plain answer' }),
      generateWithTools: vi.fn(),
      embed: vi.fn(),
    };

    const result = await new ToolExecutor(registry).run({
      llm,
      systemPrompt: 's',
      userPrompt: 'u',
      toolContext: fakeContext(),
    });

    expect(result.text).toBe('plain answer');
    expect(llm.generateWithTools).not.toHaveBeenCalled();
  });
});
