import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  COMM_API_KEY: z.string().min(1, 'COMM_API_KEY is required for Caspian SDK connectivity'),
  COMM_BASE_URL: z.string().url().default('https://api.trycaspianai.com'),
  GITHUB_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(): Env {
  // Fallback credentials in test mode to prevent module boot errors
  const isTest =
    process.env.NODE_ENV === 'test' || typeof (globalThis as any).describe === 'function';
  const target = isTest
    ? {
        ...process.env,
        COMM_API_KEY: process.env.COMM_API_KEY || 'mock_api_key',
        NODE_ENV: 'test',
      }
    : process.env;

  const result = envSchema.safeParse(target);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Environment validation failed: ${issues}`);
  }
  return result.data;
}

export const env = parseEnv();
