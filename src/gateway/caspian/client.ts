import { CommClient } from 'caspian-sdk';
import type { ClientOptions } from 'caspian-sdk';
import { env } from '../../config/env.js';

/**
 * Single place the Caspian client is constructed, so credentials and timeouts
 * are configured identically for the runtime, the CLI, and tests.
 */
export function createCommClient(overrides: ClientOptions = {}): CommClient {
  return new CommClient({
    apiKey: env.CASPIAN_API_KEY,
    baseUrl: env.CASPIAN_BASE_URL,
    timeout: env.CASPIAN_TIMEOUT_SECONDS,
    ...overrides,
  });
}
