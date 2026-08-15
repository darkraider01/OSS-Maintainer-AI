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
    private readonly providerName: string = 'openrouter'
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

  private isOpenRouter(): boolean {
    return this.providerName.toLowerCase() === 'openrouter';
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

    metrics.llmRequestsTotal.inc({ provider: this.providerName });
    const requestStart = Date.now();

    try {
      if (this.isOpenRouter()) {
        const model = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';
        const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt });
        }
        if (history && history.length > 0) {
          for (const h of history) {
            messages.push({ role: h.role, content: h.content });
          }
        }
        messages.push({ role: 'user', content: userPrompt });

        const data = await this.executor.execute(async () => {
          const url = `${baseUrl}/chat/completions`;
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
              'HTTP-Referer':
                process.env.OPENROUTER_REFERER ||
                'https://github.com/darkraider01/OSS-Maintainer-AI',
              'X-Title': process.env.OPENROUTER_TITLE || 'OSS-Maintainer-AI',
            },
            body: JSON.stringify({
              model,
              messages,
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new HttpStatusError(
              `OpenRouter API returned status ${response.status}: ${errText}`,
              response.status
            );
          }

          return (await response.json()) as any;
        });

        const choice = data.choices?.[0];
        const text =
          choice?.message?.content || choice?.text || 'No response generated by OpenRouter.';

        metrics.llmRequestDuration.observeSeconds((Date.now() - requestStart) / 1000, {
          provider: this.providerName,
        });
        return {
          text,
          metadata: { live: true, model, provider: 'openrouter' },
        };
      }

      // Default: Gemini
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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
        metadata: { live: true, model, provider: 'gemini' },
      };
    } catch (error: any) {
      metrics.llmFailuresTotal.inc({ provider: this.providerName });
      metrics.llmRequestDuration.observeSeconds((Date.now() - requestStart) / 1000, {
        provider: this.providerName,
      });
      logger.error(
        { err: error, circuitState: this.executor.getState() },
        `${this.providerName} API call failed after retries`
      );
      return {
        text: "I'm having trouble reaching the AI service right now. A maintainer will follow up, or please try again shortly.",
        metadata: { live: true, error: true, errorMessage: error.message },
      };
    }
  }

  /**
   * Function calling with real tool definitions.
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

    metrics.llmRequestsTotal.inc({ provider: this.providerName });
    const requestStart = Date.now();

    try {
      if (this.isOpenRouter()) {
        const model = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';
        const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt });
        }
        if (history && history.length > 0) {
          for (const h of history) {
            messages.push({ role: h.role, content: h.content });
          }
        }
        messages.push({ role: 'user', content: userPrompt });

        const body: Record<string, unknown> = {
          model,
          messages,
        };

        if (tools.length > 0) {
          body.tools = tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }));
        }

        const data = await this.executor.execute(async () => {
          const url = `${baseUrl}/chat/completions`;
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
              'HTTP-Referer':
                process.env.OPENROUTER_REFERER ||
                'https://github.com/darkraider01/OSS-Maintainer-AI',
              'X-Title': process.env.OPENROUTER_TITLE || 'OSS-Maintainer-AI',
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new HttpStatusError(
              `OpenRouter API returned status ${response.status}: ${errText}`,
              response.status
            );
          }

          return (await response.json()) as any;
        });

        metrics.llmRequestDuration.observeSeconds((Date.now() - requestStart) / 1000, {
          provider: this.providerName,
        });

        const message = data.choices?.[0]?.message;
        const rawToolCalls: any[] = message?.tool_calls ?? [];
        const toolCalls: ToolCallRequest[] = rawToolCalls
          .filter((tc) => tc.function?.name)
          .map((tc) => {
            let args: Record<string, unknown> = {};
            if (typeof tc.function.arguments === 'string') {
              try {
                args = JSON.parse(tc.function.arguments);
              } catch {
                args = {};
              }
            } else if (
              typeof tc.function.arguments === 'object' &&
              tc.function.arguments !== null
            ) {
              args = tc.function.arguments;
            }
            return {
              name: tc.function.name,
              arguments: args,
            };
          });

        if (toolCalls.length > 0) {
          return { text: null, toolCalls, metadata: { live: true, model, provider: 'openrouter' } };
        }

        const text = message?.content || 'No response generated by OpenRouter.';
        return { text, toolCalls: [], metadata: { live: true, model, provider: 'openrouter' } };
      }

      // Default: Gemini
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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
        return { text: null, toolCalls, metadata: { live: true, model, provider: 'gemini' } };
      }

      const text =
        parts
          .map((part) => part.text)
          .filter(Boolean)
          .join('\n') || 'No response generated by Gemini.';
      return { text, toolCalls: [], metadata: { live: true, model, provider: 'gemini' } };
    } catch (error: any) {
      metrics.llmFailuresTotal.inc({ provider: this.providerName });
      metrics.llmRequestDuration.observeSeconds((Date.now() - requestStart) / 1000, {
        provider: this.providerName,
      });
      logger.error(
        { err: error, circuitState: this.executor.getState() },
        `${this.providerName} function-calling request failed after retries`
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

    if (this.isOpenRouter()) {
      const embModel = process.env.OPENROUTER_EMBEDDING_MODEL;
      if (!embModel) {
        return {
          vector: deterministicVector(text, EMBEDDING_DIMENSION),
          model: 'openrouter-deterministic-embedding',
          dimension: EMBEDDING_DIMENSION,
        };
      }

      const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
      const data = await this.executor.execute(async () => {
        const url = `${baseUrl}/embeddings`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: embModel,
            input: text,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new HttpStatusError(
            `OpenRouter embedding API returned status ${response.status}: ${errText}`,
            response.status
          );
        }

        return (await response.json()) as any;
      });

      const vector = data.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSION) {
        throw new Error(
          `OpenRouter embedding API returned an unexpected vector shape (length ${vector?.length ?? 'unknown'}, expected ${EMBEDDING_DIMENSION})`
        );
      }

      return { vector, model: embModel, dimension: EMBEDDING_DIMENSION };
    }

    // Default: Gemini
    const model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
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
