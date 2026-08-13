import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockLLMProvider, LiveLLMProvider } from '../../src/core/llm/llm-provider.js';
import type { ToolDefinition } from '../../src/core/llm/llm-provider.js';

const SEARCH_TOOL: ToolDefinition = {
  name: 'search_documentation',
  description: 'search docs',
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
};

describe('MockLLMProvider.generateWithTools', () => {
  it('requests the first offered tool when tools are available', async () => {
    const provider = new MockLLMProvider();
    const result = await provider.generateWithTools('sys', 'what does this do?', [SEARCH_TOOL]);
    expect(result.text).toBeNull();
    expect(result.toolCalls).toEqual([
      { name: 'search_documentation', arguments: { query: 'what does this do?' } },
    ]);
  });

  it('answers directly once no tools are offered (the forced-final-answer round)', async () => {
    const provider = new MockLLMProvider();
    const result = await provider.generateWithTools(
      'sys',
      'follow-up with tool results embedded',
      []
    );
    expect(result.toolCalls).toHaveLength(0);
    expect(result.text).toContain('[Mock LLM Response]');
    expect(result.text).toContain('follow-up with tool results embedded');
  });
});

describe('LiveLLMProvider.generateWithTools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('declares tools via functionDeclarations and parses a functionCall response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'search_documentation', args: { query: 'setup' } } }],
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LiveLLMProvider('real-api-key', 'gemini');
    const result = await provider.generateWithTools('sys', 'how do I set this up?', [SEARCH_TOOL]);

    expect(result.text).toBeNull();
    expect(result.toolCalls).toEqual([
      { name: 'search_documentation', arguments: { query: 'setup' } },
    ]);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.tools[0].functionDeclarations[0].name).toBe('search_documentation');
  });

  it('returns plain text and no tool calls when the model answers directly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Here is the answer.' }] } }],
        }),
      })
    );

    const provider = new LiveLLMProvider('real-api-key', 'gemini');
    const result = await provider.generateWithTools('sys', 'a question', []);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.text).toBe('Here is the answer.');
  });

  it('omits the tools field entirely when no tools are offered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LiveLLMProvider('real-api-key', 'gemini');
    await provider.generateWithTools('sys', 'u', []);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).tools).toBeUndefined();
  });

  it('degrades gracefully to a fallback message on API failure, without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })
    );

    const provider = new LiveLLMProvider('real-api-key', 'gemini');
    const result = await provider.generateWithTools('sys', 'u', [SEARCH_TOOL]);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.text).toMatch(/trouble reaching the AI service/i);
  });

  it('falls back to the mock when only a demo API key is configured', async () => {
    const provider = new LiveLLMProvider('mock_api_key', 'gemini');
    const result = await provider.generateWithTools('sys', 'question here', [SEARCH_TOOL]);
    expect(result.toolCalls).toEqual([
      { name: 'search_documentation', arguments: { query: 'question here' } },
    ]);
  });
});
