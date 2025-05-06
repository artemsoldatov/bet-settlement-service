import { execSync } from 'node:child_process';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedpandaContainer, StartedRedpandaContainer } from '@testcontainers/redpanda';

export interface KafkaStack {
  pg: StartedPostgreSqlContainer;
  redpanda: StartedRedpandaContainer;
}

export async function startKafkaStack(): Promise<KafkaStack> {
  const [pg, redpanda] = await Promise.all([
    new PostgreSqlContainer('postgres:16').start(),
    new RedpandaContainer('redpandadata/redpanda:v24.2.7').start(),
  ]);
  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.KAFKA_BROKERS = redpanda.getBootstrapServers().replace(/^PLAINTEXT:\/\//, '');
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
  return { pg, redpanda };
}

export async function stopKafkaStack(stack: KafkaStack): Promise<void> {
  await Promise.all([stack.pg.stop(), stack.redpanda.stop()]);
}
