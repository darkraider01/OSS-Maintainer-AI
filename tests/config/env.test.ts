import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

const base = { NODE_ENV: 'production', CASPIAN_API_KEY: 'key_live' };

describe('environment configuration', () => {
  it('applies Caspian defaults', () => {
    const env = parseEnv(base);

    expect(env.CASPIAN_BASE_URL).toBe('https://api.trycaspianai.com');
    expect(env.CASPIAN_INGRESS_MODE).toBe('poll');
    expect(env.CASPIAN_ENABLED_CHANNELS).toEqual(['github']);
    expect(env.GITHUB_RECEIVE_MODE).toBe('mentions');
  });

  it('accepts the legacy COMM_* names the SDK still supports', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      COMM_API_KEY: 'key_legacy',
      COMM_BASE_URL: 'https://gateway.example.com',
    });

    expect(env.CASPIAN_API_KEY).toBe('key_legacy');
    expect(env.CASPIAN_BASE_URL).toBe('https://gateway.example.com');
  });

  it('prefers CASPIAN_* over the legacy names', () => {
    const env = parseEnv({ ...base, COMM_API_KEY: 'key_legacy' });

    expect(env.CASPIAN_API_KEY).toBe('key_live');
  });

  it('requires an API key outside test mode', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/CASPIAN_API_KEY/);
  });

  it('requires a webhook secret in webhook ingress mode', () => {
    expect(() => parseEnv({ ...base, CASPIAN_INGRESS_MODE: 'webhook' })).toThrow(
      /CASPIAN_WEBHOOK_SECRET/
    );
  });

  it('parses a comma-separated channel list', () => {
    const env = parseEnv({ ...base, CASPIAN_ENABLED_CHANNELS: 'github, Slack ,' });

    expect(env.CASPIAN_ENABLED_CHANNELS).toEqual(['github', 'slack']);
  });
});
