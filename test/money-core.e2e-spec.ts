import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AccountsService, WalletAccounts } from '../src/betting/accounts.service';
import { BettingService } from '../src/betting/betting.service';
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

  async function wallet(): Promise<WalletAccounts> {
    return accounts.ensureWallet(`user-${randomUUID()}`);
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
    const w = await wallet();
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
  });
});
