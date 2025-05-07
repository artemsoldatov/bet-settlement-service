import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { AccountsService } from '../src/betting/accounts.service';
import { BettingService } from '../src/betting/betting.service';
import { SelectionResult } from '../src/generated/prisma/client';
import { KafkaService } from '../src/kafka/kafka.service';
import { TOPIC_MARKET_SETTLED } from '../src/kafka/topics';
import { PrismaService } from '../src/prisma/prisma.service';
import { MarketSettledConsumer } from '../src/settlement-flow/market-settled.consumer';
import { MarketsService } from '../src/settlement-flow/markets.service';
import { OutboxRelay } from '../src/settlement-flow/outbox.relay';
import { KafkaStack } from './helpers/kafka-stack';

async function until<T>(probe: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== null) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('settlement flow (e2e, Kafka)', () => {
  let stack: KafkaStack;
  let app: TestingModule;
  let prisma: PrismaService;
  let accounts: AccountsService;
  let betting: BettingService;
  let markets: MarketsService;
  let relay: OutboxRelay;
  let consumer: MarketSettledConsumer;
  let kafka: KafkaService;

  beforeAll(async () => {
    const { startKafkaStack } = await import('./helpers/kafka-stack');
    stack = await startKafkaStack();
    const { createTestContext } = await import('./helpers/app');
    app = await createTestContext();

    prisma = app.get(PrismaService);
    accounts = app.get(AccountsService);
    betting = app.get(BettingService);
    markets = app.get(MarketsService);
    relay = app.get(OutboxRelay);
    consumer = app.get(MarketSettledConsumer);
    kafka = app.get(KafkaService);

    await accounts.ensureHouse('USD');
    await kafka.connectProducer();
    await kafka.ensureTopics();
    await consumer.start();
  }, 120_000);

  afterAll(async () => {
    await consumer.stop();
    await kafka.disconnect();
    await app.close();
    const { stopKafkaStack } = await import('./helpers/kafka-stack');
    await stopKafkaStack(stack);
  });

  async function marketWithBet(
    result: SelectionResult,
    stakeCents = 200n,
  ): Promise<{ marketId: string; betId: string; cashId: string }> {
    const wallet = await accounts.ensureWallet(`user-${randomUUID()}`);
    await accounts.fundCash(wallet.cashId, 1_000n);
    const market = await prisma.market.create({ data: { eventId: `evt-${randomUUID()}` } });
    const selection = await prisma.selection.create({
      data: { marketId: market.id, code: 'home', oddsNum: 2n, oddsDen: 1n, result },
    });
    const bet = await betting.place({
      walletId: wallet.walletId,
      cashId: wallet.cashId,
      unsettledId: wallet.unsettledId,
      selectionId: selection.id,
      stakeCents,
      oddsNum: 2n,
      oddsDen: 1n,
      idempotencyKey: `k-${randomUUID()}`,
    });
    return { marketId: market.id, betId: bet.id, cashId: wallet.cashId };
  }

  it('settles bets through the full outbox -> Kafka -> consumer flow', async () => {
    const { marketId, betId, cashId } = await marketWithBet(SelectionResult.WIN);

    await markets.settleMarket(marketId, { home: SelectionResult.WIN });
    await relay.tick(); // publish the outbox event to Kafka

    const settled = await until(async () => {
      const bet = await prisma.bet.findUnique({ where: { id: betId } });
      return bet?.status === 'SETTLED' ? bet : null;
    });
    expect(settled.outcome).toBe('WIN');
    // 1000 - 200 stake + 400 payout = 1200
    expect(await accounts.balanceOf(cashId)).toBe(1_200n);
  });

  it('handles a duplicated delivery exactly once (inbox)', async () => {
    const { marketId, betId, cashId } = await marketWithBet(SelectionResult.WIN);
    const eventId = `evt-dup-${randomUUID()}`;

    // deliver the same event id twice, straight to the topic
    const send = () =>
      kafka.getProducer().send({
        topic: TOPIC_MARKET_SETTLED,
        messages: [
          {
            key: marketId,
            value: JSON.stringify({ marketId }),
            headers: { eventId, traceparent: '' },
          },
        ],
      });
    await send();
    await send();

    await until(async () => {
      const bet = await prisma.bet.findUnique({ where: { id: betId } });
      return bet?.status === 'SETTLED' ? bet : null;
    });

    expect(await prisma.settlement.count({ where: { betId } })).toBe(1);
    expect(await prisma.processedEvent.count({ where: { eventId } })).toBe(1);
    // payout booked once
    expect(await accounts.balanceOf(cashId)).toBe(1_200n);
  });
});
