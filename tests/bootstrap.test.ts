import { describe, it, expect, vi } from 'vitest';
import { bootstrap } from '../src/index.js';

// Mock Caspian SDK CommClient
vi.mock('caspian-sdk', () => {
  function CommClient() {
    return {
      onMessage: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
    };
  }
  return { CommClient };
});

describe('OSS-Maintainer-AI Core Bootstrap', () => {
  it('successfully initializes and runs CommClient', async () => {
    // Set mock env values for loader
    process.env.COMM_API_KEY = 'mock_api_key';

    await expect(bootstrap()).resolves.not.toThrow();
  });
});
