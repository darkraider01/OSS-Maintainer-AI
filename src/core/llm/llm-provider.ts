import { createHash } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { ResilientExecutor } from '../resilience/resilient-executor.js';
import { metrics } from '../observability/metrics.js';

export interface LLMResponse {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dimension: number;
}

/** Name/description/JSON-schema-parameters — everything the model needs to decide whether to call a tool, minus the execute() implementation (that stays server-side). */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallingResult {
  /** Null when the model requested tool call(s) instead of answering directly. */
  text: string | null;
  toolCalls: ToolCallRequest[];
  metadata?: Record<string, unknown>;
}

export interface LLMProvider {
  name: string;
  supportsTools(): boolean;
  supportsVision(): boolean;
  supportsReasoning(): boolean;
  generate(
    systemPrompt: string,
    userPrompt: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<LLMResponse>;
  /**
   * One round of real function-calling: the model either answers directly
   * or requests tool call(s) it wants executed. Callers wanting a full
   * "ask -> execute -> final answer" loop should use `ToolExecutor`
   * (src/core/tools/tool-executor.ts), not call this in a loop themselves.
   */
  generateWithTools(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[],
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<ToolCallingResult>;
  embed(text: string): Promise<EmbeddingResult>;
}

/** Matches the `embeddings.vector` schema's fixed `vector(1536)` column. */
const EMBEDDING_DIMENSION = 1536;

/**
 * Deterministic, dependency-free fake embedding: SHA-256-chains the input to
 * fill `dimension` floats, then normalizes to a unit vector. Same input always
 * produces the same output — good enough for demo mode and tests, no network.
 */
function deterministicVector(text: string, dimension: number): number[] {
  const vector: number[] = [];
  let block = text;
  while (vector.length < dimension) {
    const hash = createHash('sha256').update(block).digest();
    for (let i = 0; i + 4 <= hash.length && vector.length < dimension; i += 4) {
      vector.push((hash.readUInt32BE(i) / 0xffffffff) * 2 - 1);
    }
    block = hash.toString('hex');
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock-llm';

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return false;
  }

  supportsReasoning(): boolean {
    return false;
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    _history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<LLMResponse> {
    // Return deterministic mock response for demos and testing without api keys
    return {
      text: `[Mock LLM Response]\nBased on your message: "${userPrompt}"\nI am analyzing this context as a Maintainer Agent. All tests are passing successfully!`,
      metadata: {
        mocked: true,
        tokensUsed: 42,
      },
    };
  }

  /**
   * Deterministic simulation, not a real model decision: requests the
   * first offered tool once (good enough to exercise ToolExecutor's loop in
   * tests/demo mode without a network call), then answers directly once no
   * tools are offered (ToolExecutor's forced-final-answer round).
   */
  async generateWithTools(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[],
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<ToolCallingResult> {
    if (tools.length > 0) {
      return { text: null, toolCalls: [{ name: tools[0].name, arguments: { query: userPrompt } }] };
    }
    const generated = await this.generate(systemPrompt, userPrompt, history);
    return { text: generated.text, toolCalls: [], metadata: generated.metadata };
  }

  async embed(text: string): Promise<EmbeddingResult> {
    return {
      vector: deterministicVector(text, EMBEDDING_DIMENSION),
      model: 'mock-embedding',
      dimension: EMBEDDING_DIMENSION,
    };
  }
}

/** Marks an HTTP error with the response status so retry-policy can classify it. */
class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

export class LiveLLMProvider implements LLMProvider {
  readonly name = 'live-llm';
  private readonly executor: ResilientExecutor;

  constructor(
    private readonly apiKey: string,
    private readonly providerName: string = 'gemini'
  ) {
    this.executor = new ResilientExecutor(`llm-${providerName}`);
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }

  supportsReasoning(): boolean {
    return true;
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<LLMResponse> {
    // If live API calls are configured, we invoke them. Fallback to mock if API is demo-configured.
    if (!this.apiKey || this.apiKey === 'mock_api_key' || this.apiKey.startsWith('mock')) {
      return new MockLLMProvider().generate(systemPrompt, userPrompt, history);
    }
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    // Call the actual Gemini API using native fetch. Transient failures
    // (timeouts, 429, 5xx) retry with backoff inside the circuit breaker;
    // once attempts/breaker are exhausted this still never throws out of
    // MaintainerAgent — it degrades to a text response so WorkflowEngine
    // always has something to reply with (PRD §10: "do not crash runtime").
    metrics.llmRequestsTotal.inc({ provider: this.providerName });
    const requestStart = Date.now();
    try {
      const data = await this.executor.execute(async () => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `System Prompt:\n${systemPrompt}\n\nUser Prompt:\n${userPrompt}`,
                  },
                ],
              },
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new HttpStatusError(
            `Gemini API returned status ${response.status}: ${errText}`,
            response.status
          );
        }

        return (await response.json()) as any;
      });

      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated by Gemini.';

      metrics.llmRequestDuration.observeSeconds((Date.now() - requestStart) / 1000, {
        provider: this.providerName,
      });
      return {
        text,
        metadata: { live: true, model },
      };
    } catch (error: any) {
      metrics.llmFailuresTotal.inc({ provider: this.providerName });
      metrics.llmRequestDuration.observeSeconds((Date.now() - requestStart) / 1000, {
        provider: this.providerName,
      });
      logger.error(
        { err: error, circuitState: this.executor.getState() },
        'Gemini API call failed after retries'
      );
      return {
        text: "I'm having trouble reaching the AI service right now. A maintainer will follow up, or please try again shortly.",
        metadata: { live: true, error: true, errorMessage: error.message },
      };
    }
  }

  /**
   * Real Gemini function-calling: declares `tools` via `functionDeclarations`
   * and parses `functionCall` parts back out of the response. Conversation
   * history is text-embedded into the prompt rather than passed as
   * structured turns — the same simplification `generate()` already makes
   * (see docs/implementation/remaining-work.md §6) — but the tool
   * declaration/parsing itself is the real API mechanism, not a simulation.
   */
  async generateWithTools(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[],
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<ToolCallingResult> {
    if (!this.apiKey || this.apiKey === 'mock_api_key' || this.apiKey.startsWith('mock')) {
      return new MockLLMProvider().generateWithTools(systemPrompt, userPrompt, tools, history);
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    metrics.llmRequestsTotal.inc({ provider: this.providerName });
    const requestStart = Date.now();
    try {
      const data = await this.executor.execute(async () => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
        const body: Record<string, unknown> = {
          contents: [
            {
              role: 'user',
              parts: [{ text: `System Prompt:\n${systemPrompt}\n\nUser Prompt:\n${userPrompt}` }],
            },
          ],
        };
        if (tools.length > 0) {
          body.tools = [
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            },
          ];
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new HttpStatusError(
            `Gemini API returned status ${response.status}: ${errText}`,
            response.status
          );
        }

        return (await response.json()) as any;
      });

      metrics.llmRequestDuration.observeSeconds((Date.now() - requestStart) / 1000, {
        provider: this.providerName,
      });

      const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
      const toolCalls: ToolCallRequest[] = parts
        .filter((part) => part.functionCall)
        .map((part) => ({ name: part.functionCall.name, arguments: part.functionCall.args ?? {} }));

      if (toolCalls.length > 0) {
        return { text: null, toolCalls, metadata: { live: true, model } };
      }

      const text =
        parts
          .map((part) => part.text)
          .filter(Boolean)
          .join('\n') || 'No response generated by Gemini.';
      return { text, toolCalls: [], metadata: { live: true, model } };
    } catch (error: any) {
      metrics.llmFailuresTotal.inc({ provider: this.providerName });
      metrics.llmRequestDuration.observeSeconds((Date.now() - requestStart) / 1000, {
        provider: this.providerName,
      });
      logger.error(
        { err: error, circuitState: this.executor.getState() },
        'Gemini function-calling request failed after retries'
      );
      return {
        text: "I'm having trouble reaching the AI service right now. A maintainer will follow up, or please try again shortly.",
        toolCalls: [],
        metadata: { live: true, error: true, errorMessage: error.message },
      };
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    if (!this.apiKey || this.apiKey === 'mock_api_key' || this.apiKey.startsWith('mock')) {
      return new MockLLMProvider().embed(text);
    }
    const model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
    // Ingestion callers (pnpm run ingest:docs) need to know if embedding
    // ultimately failed, so — unlike generate() — this still throws after
    // retries/breaker are exhausted rather than degrading to a fake vector.
    const data = await this.executor.execute(async () => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: EMBEDDING_DIMENSION,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new HttpStatusError(
          `Gemini embedding API returned status ${response.status}: ${errText}`,
          response.status
        );
      }

      return (await response.json()) as any;
    });

    const vector = data.embedding?.values;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Gemini embedding API returned an unexpected vector shape (length ${vector?.length ?? 'unknown'}, expected ${EMBEDDING_DIMENSION})`
      );
    }

    return { vector, model, dimension: EMBEDDING_DIMENSION };
  }
}
