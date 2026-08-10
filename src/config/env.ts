import { z } from 'zod';

/**
 * The Caspian SDK reads `CASPIAN_*` first and falls back to the legacy `COMM_*`
 * names. We mirror that resolution order so a single `.env` drives both the SDK
 * and this application.
 */
const CASPIAN_ALIASES: Record<string, string> = {
  CASPIAN_API_KEY: 'COMM_API_KEY',
  CASPIAN_BASE_URL: 'COMM_BASE_URL',
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Caspian gateway ---
  CASPIAN_API_KEY: z.string().default('mock_api_key'),
  CASPIAN_BASE_URL: z.string().url().default('https://api.trycaspianai.com'),
  CASPIAN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),

  /**
   * `poll` runs the SDK event loop (long-lived process, no public URL needed).
   * `webhook` exposes an HTTP endpoint the gateway pushes deliveries to.
   */
  CASPIAN_INGRESS_MODE: z.enum(['poll', 'webhook']).default('poll'),
  CASPIAN_WEBHOOK_PATH: z.string().startsWith('/').default('/webhooks/caspian'),
  CASPIAN_WEBHOOK_SECRET: z.string().optional(),
  /** Public URL registered with the gateway via `setWebhook`. */
  CASPIAN_WEBHOOK_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional()
  ),
  PORT: z.coerce.number().int().positive().default(3000),

  /** Channels we accept ingress from. GitHub is the first (FR-1). */
  CASPIAN_ENABLED_CHANNELS: z
    .string()
    .default('github')
    .transform((value) =>
      value
        .split(',')
        .map((channel) => channel.trim().toLowerCase())
        .filter(Boolean)
    ),

  // --- GitHub channel provisioning (Caspian bring-your-own-App flow) ---
  /** Set all four to bring your own GitHub App; leave unset for one-click install. */
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_RECEIVE_MODE: z.enum(['mentions', 'all']).default('mentions'),
  GITHUB_TOKEN: z.string().optional(),

  /**
   * Direct GitHub channel (bypasses Caspian — GitHub is not a Caspian channel
   * in the live environment). Reuses the App credentials above for GitHub App
   * JWT + installation-token auth. Optional: everything else starts normally
   * when this is left off.
   */
  GITHUB_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),
  GITHUB_INSTALLATION_ID: z.string().optional(),
  GITHUB_WEBHOOK_PATH: z.string().startsWith('/').default('/webhooks/github'),

  /**
   * Account-linking dashboard: lets one human tie their GitHub, Slack, and
   * Discord identities to a single actor, so cross-channel memory actually
   * spans providers. Shares the webhook HTTP server/port. Optional: everything
   * else starts normally when this is left off.
   */
  AUTH_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),
  /** Public base URL (no trailing slash) used to build each provider's OAuth redirect_uri. */
  AUTH_BASE_URL: z.preprocess((val) => (val === '' ? undefined : val), z.string().url().optional()),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  SLACK_OAUTH_CLIENT_ID: z.string().optional(),
  SLACK_OAUTH_CLIENT_SECRET: z.string().optional(),
  DISCORD_OAUTH_CLIENT_ID: z.string().optional(),
  DISCORD_OAUTH_CLIENT_SECRET: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DEMO_MODE: z
    .string()
    .default('true')
    .transform((value) => value.toLowerCase() === 'true'),
  LLM_PROVIDER: z.string().default('gemini'),
  LLM_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function resolveAliases(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...source };
  for (const [preferred, legacy] of Object.entries(CASPIAN_ALIASES)) {
    if (!resolved[preferred] && source[legacy]) resolved[preferred] = source[legacy];
  }
  return resolved;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Fallback credentials in test mode to prevent module boot errors
  const isTest = source.NODE_ENV === 'test' || typeof (globalThis as any).describe === 'function';
  const resolved = resolveAliases(source);
  const target = isTest
    ? {
        ...resolved,
        CASPIAN_API_KEY: resolved.CASPIAN_API_KEY || 'mock_api_key',
        NODE_ENV: 'test',
      }
    : resolved;

  const result = envSchema.safeParse(target);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Environment validation failed: ${issues}`);
  }

  if (result.data.CASPIAN_INGRESS_MODE === 'webhook' && !result.data.CASPIAN_WEBHOOK_SECRET) {
    throw new Error(
      'Environment validation failed: CASPIAN_WEBHOOK_SECRET is required when CASPIAN_INGRESS_MODE=webhook'
    );
  }

  if (result.data.GITHUB_ENABLED) {
    const missing = (
      [
        'GITHUB_APP_ID',
        'GITHUB_PRIVATE_KEY',
        'GITHUB_INSTALLATION_ID',
        'GITHUB_WEBHOOK_SECRET',
      ] as const
    ).filter((key) => !result.data[key]);
    if (missing.length > 0) {
      throw new Error(
        `Environment validation failed: ${missing.join(', ')} required when GITHUB_ENABLED=true`
      );
    }
  }

  if (result.data.AUTH_ENABLED) {
    const missing = (
      [
        'AUTH_BASE_URL',
        'GITHUB_OAUTH_CLIENT_ID',
        'GITHUB_OAUTH_CLIENT_SECRET',
        'SLACK_OAUTH_CLIENT_ID',
        'SLACK_OAUTH_CLIENT_SECRET',
        'DISCORD_OAUTH_CLIENT_ID',
        'DISCORD_OAUTH_CLIENT_SECRET',
      ] as const
    ).filter((key) => !result.data[key]);
    if (missing.length > 0) {
      throw new Error(
        `Environment validation failed: ${missing.join(', ')} required when AUTH_ENABLED=true`
      );
    }
  }

  return result.data;
}

export const env = parseEnv();
