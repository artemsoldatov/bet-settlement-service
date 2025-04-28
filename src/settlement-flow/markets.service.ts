import { Injectable } from '@nestjs/common';
import { MarketStatus, SelectionResult } from '../generated/prisma';
import { TOPIC_MARKET_SETTLED } from '../kafka/topics';
import { newTraceparent } from '../kafka/trace';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from './outbox.service';

@Injectable()
export class MarketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Settles a market: record each selection's result, mark the market SETTLED,
   * and emit `market.settled` — all in one transaction. The event reaches Kafka
   * only after the state change is durable (transactional outbox).
   */
  async settleMarket(marketId: string, results: Record<string, SelectionResult>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const [code, result] of Object.entries(results)) {
        await tx.selection.updateMany({ where: { marketId, code }, data: { result } });
      }
      await tx.market.update({
        where: { id: marketId },
        data: { status: MarketStatus.SETTLED, settledAt: new Date() },
      });
      await this.outbox.emit(
        tx,
        TOPIC_MARKET_SETTLED,
        marketId, // partition key → per-market ordering
        { marketId },
        newTraceparent(),
      );
    });
  }
}
