import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockLLMProvider, LiveLLMProvider } from '../../src/core/llm/llm-provider.js';

describe('MockLLMProvider.embed', () => {
  it('is deterministic for identical input', async () => {
    const provider = new MockLLMProvider();
    const a = await provider.embed('hello world');
    const b = await provider.embed('hello world');
    expect(a.vector).toEqual(b.vector);
  });

  it('produces different vectors for different input', async () => {
    const provider = new MockLLMProvider();
    const a = await provider.embed('hello world');
    const b = await provider.embed('goodbye world');
    expect(a.vector).not.toEqual(b.vector);
  });

  it('always returns exactly 1536 dimensions, matching the embeddings schema', async () => {
    const provider = new MockLLMProvider();
    const { vector, dimension } = await provider.embed('anything');
    expect(vector).toHaveLength(1536);
    expect(dimension).toBe(1536);
  });
});

describe('LiveLLMProvider.embed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to the deterministic mock when no real API key is configured', async () => {
    const provider = new LiveLLMProvider('mock_api_key', 'gemini');
    const mockProvider = new MockLLMProvider();
    const [live, mocked] = await Promise.all([
      provider.embed('hello world'),
      mockProvider.embed('hello world'),
    ]);
    expect(live.vector).toEqual(mocked.vector);
  });

  it('calls the Gemini embedding endpoint and returns its vector when a real key is set', async () => {
    const fakeVector = Array.from({ length: 1536 }, (_, i) => i / 1536);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: { values: fakeVector } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LiveLLMProvider('real-api-key', 'gemini');
    const result = await provider.embed('some content to embed');

    expect(result.vector).toEqual(fakeVector);
    expect(result.dimension).toBe(1536);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(':embedContent');
    expect(JSON.parse(init.body).outputDimensionality).toBe(1536);
  });

  it('throws when the API returns a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' })
    );
    const provider = new LiveLLMProvider('real-api-key', 'gemini');
    await expect(provider.embed('text')).rejects.toThrow(/status 500/);
  });

  it('throws when the returned vector has the wrong dimension', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: [1, 2, 3] } }),
      })
    );
    const provider = new LiveLLMProvider('real-api-key', 'gemini');
    await expect(provider.embed('text')).rejects.toThrow(/unexpected vector shape/);
  });
});
