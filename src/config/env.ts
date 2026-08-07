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
  CASPIAN_WEBHOOK_URL: z.string().url().optional(),
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

  // --- GitHub channel provisioning ---
  /** Set all four to bring your own GitHub App; leave unset for one-click install. */
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_RECEIVE_MODE: z.enum(['mentions', 'all']).default('mentions'),
  GITHUB_TOKEN: z.string().optional(),

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

  return result.data;
}

export const env = parseEnv();
