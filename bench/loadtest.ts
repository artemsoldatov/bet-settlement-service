import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { AccountsService, WalletAccounts } from '../src/betting/accounts.service';
import { BettingService } from '../src/betting/betting.service';
import { LedgerService } from '../src/betting/ledger.service';
import { PrismaClient, SelectionResult } from '../src/generated/prisma/client';
import { MetricsService } from '../src/observability/metrics.service';
import type { PrismaService } from '../src/prisma/prisma.service';

// Services are wired by hand (no Nest DI) so the harness runs under tsx, which
// does not emit the decorator metadata Nest needs for injection.

// Node load harness (no k6 binary needed). Drives the settlement services
// directly against the local Postgres and reports MEASURED numbers. Numbers are
// hardware-dependent — run it yourself; the README quotes one local run.

const WALLETS = 50;
const BETS = 2_000;
const CONCURRENCY = 50;

function percentile(sortedMs: number[], p: number): number {
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<number>) {
  const latencies: number[] = [];
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      latencies.push(await fn(item));
    }
  });
  await Promise.all(workers);
  return latencies.sort((a, b) => a - b);
}

function report(label: string, latencies: number[], wallMs: number) {
  const throughput = (latencies.length / wallMs) * 1000;
  console.log(
    `${label.padEnd(20)} ${latencies.length} ops in ${wallMs.toFixed(0)}ms | ` +
      `${throughput.toFixed(0)} ops/s | p50 ${percentile(latencies, 50).toFixed(1)}ms | ` +
      `p99 ${percentile(latencies, 99).toFixed(1)}ms`,
  );
}

async function main(): Promise<void> {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const prisma = client as unknown as PrismaService;
  const accounts = new AccountsService(prisma);
  const betting = new BettingService(prisma, new LedgerService(), new MetricsService());
  await accounts.ensureHouse('USD');

  // spread bets over many wallets/selections to avoid single-row contention
  const wallets: WalletAccounts[] = [];
  const selectionIds: string[] = [];
  for (let i = 0; i < WALLETS; i++) {
    const w = await accounts.ensureWallet(`bench-${randomUUID()}`);
    await accounts.fundCash(w.cashId, 10_000_000n);
    wallets.push(w);
    const market = await prisma.market.create({ data: { eventId: `evt-${randomUUID()}` } });
    const sel = await prisma.selection.create({
      data: { marketId: market.id, code: 'home', oddsNum: 2n, oddsDen: 1n, result: SelectionResult.WIN },
    });
    selectionIds.push(sel.id);
  }

  const specs = Array.from({ length: BETS }, (_, i) => ({
    w: wallets[i % WALLETS],
    selectionId: selectionIds[i % WALLETS],
    key: `bench-${randomUUID()}`,
  }));

  console.log(`\nBet Settlement load test — ${BETS} bets, ${WALLETS} wallets, concurrency ${CONCURRENCY}\n`);

  const placedIds: string[] = [];
  let t = Date.now();
  const placeLat = await pool(specs, CONCURRENCY, async (s) => {
    const start = performance.now();
    const bet = await betting.place({
      walletId: s.w.walletId,
      cashId: s.w.cashId,
      unsettledId: s.w.unsettledId,
      selectionId: s.selectionId,
      stakeCents: 100n,
      oddsNum: 2n,
      oddsDen: 1n,
      idempotencyKey: s.key,
    });
    placedIds.push(bet.id);
    return performance.now() - start;
  });
  report('place', placeLat, Date.now() - t);

  t = Date.now();
  const settleLat = await pool(placedIds, CONCURRENCY, async (id) => {
    const start = performance.now();
    await betting.settle(id);
    return performance.now() - start;
  });
  report('settle', settleLat, Date.now() - t);

  // exactly-once under injected duplicates: fire 5 concurrent settles per bet
  const sample = placedIds.slice(0, 200);
  await Promise.all(sample.flatMap((id) => Array.from({ length: 5 }, () => betting.settle(id))));
  const settlements = await prisma.settlement.count({ where: { betId: { in: sample } } });
  console.log(
    `\nexactly-once check: ${sample.length} bets x5 concurrent settles → ` +
      `${settlements} settlements (double-payouts: ${settlements - sample.length})\n`,
  );

  await client.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
