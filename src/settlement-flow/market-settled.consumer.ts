import { Injectable, Logger } from '@nestjs/common';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { BettingService } from '../betting/betting.service';
import { BetStatus, Prisma } from '../generated/prisma';
import { KafkaService } from '../kafka/kafka.service';
import { TOPIC_MARKET_SETTLED } from '../kafka/topics';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Consumes `markets.settled` and settles every accepted bet on the market.
 * Delivery is at-least-once; the inbox (processed_events, keyed by the event id)
 * makes handling effectively-once, and settle() is idempotent on its own.
 */
@Injectable()
export class MarketSettledConsumer {
  private readonly logger = new Logger(MarketSettledConsumer.name);
  private consumer?: Consumer;

  constructor(
    private readonly kafka: KafkaService,
    private readonly prisma: PrismaService,
    private readonly betting: BettingService,
  ) {}

  async start(groupId = 'market-settled'): Promise<void> {
    const consumer = this.kafka.createConsumer(groupId);
    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC_MARKET_SETTLED, fromBeginning: true });
    await consumer.run({ eachMessage: (payload) => this.handle(payload) });
    this.consumer = consumer;
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = undefined;
    }
  }

  private async handle({ message }: EachMessagePayload): Promise<void> {
    const eventId = message.headers?.eventId?.toString() ?? '';
    const { marketId } = JSON.parse(message.value?.toString() ?? '{}') as { marketId?: string };
    if (!eventId || !marketId) {
      return; // malformed, nothing to do
    }

    // fast-path dedup; settle() is idempotent anyway, this skips re-work
    const seen = await this.prisma.processedEvent.findUnique({ where: { eventId } });
    if (seen) {
      return;
    }

    await this.settleMarketBets(marketId);
    await this.markProcessed(eventId);
    this.logger.debug(`Settled market ${marketId}`);
  }

  private async markProcessed(eventId: string): Promise<void> {
    try {
      await this.prisma.processedEvent.create({
        data: { eventId, consumer: 'market-settled' },
      });
    } catch (error) {
      // a concurrent delivery already recorded it — fine
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }
  }

  private async settleMarketBets(marketId: string): Promise<void> {
    const bets = await this.prisma.bet.findMany({
      where: { status: BetStatus.ACCEPTED, selection: { marketId } },
      select: { id: true },
    });
    for (const bet of bets) {
      await this.betting.settle(bet.id);
    }
  }
}
