import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AccountsService, WalletAccounts } from '../src/betting/accounts.service';
import { BettingService } from '../src/betting/betting.service';
import { InsufficientFundsError } from '../src/betting/errors';
import { SelectionResult } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

describe('money core (e2e)', () => {
  let pg: StartedPostgreSqlContainer;
  let app: TestingModule;
  let accounts: AccountsService;
  let betting: BettingService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const { startPostgres } = await import('./helpers/containers');
    pg = await startPostgres();
    const { createTestContext } = await import('./helpers/app');
    app = await createTestContext();
    accounts = app.get(AccountsService);
    betting = app.get(BettingService);
    prisma = app.get(PrismaService);
    await accounts.ensureHouse('USD');
  });

  afterAll(async () => {
    await app.close();
    await pg.stop();
  });

  async function fundedWallet(balanceCents: bigint): Promise<WalletAccounts> {
    const w = await accounts.ensureWallet(`user-${randomUUID()}`);
    await accounts.fundCash(w.cashId, balanceCents);
    return w;
  }

  async function selection(
    oddsNum: bigint,
    oddsDen: bigint,
    result: SelectionResult = SelectionResult.PENDING,
  ): Promise<string> {
    const market = await prisma.market.create({ data: { eventId: `evt-${randomUUID()}` } });
    const sel = await prisma.selection.create({
      data: { marketId: market.id, code: 'home', oddsNum, oddsDen, result },
    });
    return sel.id;
  }

  it('places a bet exactly once under a concurrent identical Idempotency-Key', async () => {
    const w = await fundedWallet(1_000n);
    const selectionId = await selection(2n, 1n);
    const key = `idem-${randomUUID()}`;

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        betting.place({
          walletId: w.walletId,
          cashId: w.cashId,
          unsettledId: w.unsettledId,
          selectionId,
          stakeCents: 400n,
          oddsNum: 2n,
          oddsDen: 1n,
          idempotencyKey: key,
        }),
      ),
    );

    const ids = new Set(results.map((b) => b.id));
    expect(ids.size).toBe(1);
    expect(await prisma.bet.count({ where: { walletId: w.walletId } })).toBe(1);
    expect(await accounts.balanceOf(w.cashId)).toBe(600n); // debited once
    expect(await accounts.balanceOf(w.unsettledId)).toBe(400n);
  });

  it('settles a bet exactly once under a concurrent settle race', async () => {
    const w = await fundedWallet(1_000n);
    const selectionId = await selection(3n, 1n, SelectionResult.WIN);
    const bet = await betting.place({
      walletId: w.walletId,
      cashId: w.cashId,
      unsettledId: w.unsettledId,
      selectionId,
      stakeCents: 200n,
      oddsNum: 3n,
      oddsDen: 1n,
      idempotencyKey: `k-${randomUUID()}`,
    });

    await Promise.all(Array.from({ length: 5 }, () => betting.settle(bet.id)));

    expect(await prisma.settlement.count({ where: { betId: bet.id } })).toBe(1);
    // cash: 1000 - 200 stake + 600 payout = 1400, booked once
    expect(await accounts.balanceOf(w.cashId)).toBe(1_400n);
    expect(await accounts.balanceOf(w.unsettledId)).toBe(0n);
  });

  it('never overdraws under concurrent placements that exceed the balance', async () => {
    const w = await fundedWallet(100n);
    const selectionId = await selection(2n, 1n);

    const attempts = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        betting.place({
          walletId: w.walletId,
          cashId: w.cashId,
          unsettledId: w.unsettledId,
          selectionId,
          stakeCents: 60n,
          oddsNum: 2n,
          oddsDen: 1n,
          idempotencyKey: `k-${randomUUID()}`,
        }),
      ),
    );

    const placed = attempts.filter((a) => a.status === 'fulfilled').length;
    const rejected = attempts.filter(
      (a) => a.status === 'rejected' && a.reason instanceof InsufficientFundsError,
    ).length;

    expect(placed).toBe(1);
    expect(rejected).toBe(2);
    expect(await accounts.balanceOf(w.cashId)).toBe(40n);
    expect(await accounts.balanceOf(w.cashId)).toBeGreaterThanOrEqual(0n);
  });
});
