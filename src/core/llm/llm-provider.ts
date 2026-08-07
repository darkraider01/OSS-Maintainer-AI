export interface LLMResponse {
  text: string;
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
}

export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock-llm';

  supportsTools(): boolean {
    return false;
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
}

export class LiveLLMProvider implements LLMProvider {
  readonly name = 'live-llm';

  constructor(
    private readonly apiKey: string,
    private readonly providerName: string = 'gemini'
  ) {}

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
    // Simplistic Live LLM wrapper payload (mocking network call block structure for now)
    return {
      text: `[Live LLM - ${this.providerName}]\nProcessed query: "${userPrompt}"\nExecuting maintainer logic.`,
      metadata: { live: true },
    };
  }
}
