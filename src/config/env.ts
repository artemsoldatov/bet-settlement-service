import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(53001),
  DATABASE_URL: z.string().url(),
  // comma-separated list of Kafka/Redpanda brokers
  KAFKA_BROKERS: z.string().default('localhost:59092'),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
  JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${details}`);
  }
  return parsed.data;
}
