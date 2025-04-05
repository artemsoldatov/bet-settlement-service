import { execSync } from 'node:child_process';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  const pg = await new PostgreSqlContainer('postgres:16').start();
  process.env.DATABASE_URL = pg.getConnectionUri();
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
  return pg;
}
