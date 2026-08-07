import { githubAdapter } from './github.js';
import type { IntegrationAdapter } from './types.js';

/**
 * Resolves the adapter for an inbound channel. A channel with no registered
 * adapter is unroutable by design — the gateway skips it instead of guessing.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, IntegrationAdapter>();

  constructor(adapters: IntegrationAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: IntegrationAdapter): this {
    this.adapters.set(adapter.channel.toLowerCase(), adapter);
    return this;
  }

  resolve(channel: string): IntegrationAdapter | undefined {
    return this.adapters.get(channel.toLowerCase());
  }

  channels(): string[] {
    return [...this.adapters.keys()];
  }
}

/** The default registry. GitHub is the first integration (FR-1). */
export function createDefaultRegistry(): AdapterRegistry {
  return new AdapterRegistry([githubAdapter]);
}
