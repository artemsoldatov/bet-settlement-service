import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { BettingService } from '../betting/betting.service';
import type { Env } from '../config/env';
import { BetStatus, Prisma } from '../generated/prisma';
import { KafkaService } from '../kafka/kafka.service';
import { TOPIC_DLT, TOPIC_MARKET_SETTLED } from '../kafka/topics';
import { traceIdOf } from '../kafka/trace';
import { MetricsService } from '../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Consumes `markets.settled` and settles every accepted bet on the market.
 * Delivery is at-least-once; the inbox (processed_events, keyed by the event id)
 * makes handling effectively-once, and settle() is idempotent on its own. A
 * message that keeps failing is dead-lettered after JOB_ATTEMPTS instead of
 * blocking the partition forever.
 */
@Injectable()
export class MarketSettledConsumer {
  private readonly logger = new Logger(MarketSettledConsumer.name);
  private readonly maxAttempts: number;
  private readonly attempts = new Map<string, number>();
  private consumer?: Consumer;

  constructor(
    private readonly kafka: KafkaService,
    private readonly prisma: PrismaService,
    private readonly betting: BettingService,
    private readonly metrics: MetricsService,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('JOB_ATTEMPTS', { infer: true });
  }

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
    const traceparent = message.headers?.traceparent?.toString();
    const { marketId } = JSON.parse(message.value?.toString() ?? '{}') as { marketId?: string };
    if (!eventId || !marketId) {
      return; // malformed, nothing to do
    }

    // fast-path dedup; settle() is idempotent anyway, this skips re-work
    const seen = await this.prisma.processedEvent.findUnique({ where: { eventId } });
    if (seen) {
      this.metrics.duplicatesSkipped.inc();
      return;
    }

    try {
      await this.settleMarketBets(marketId);
      await this.markProcessed(eventId);
      this.attempts.delete(eventId);
      this.logger.debug(`Settled market ${marketId} [trace ${traceIdOf(traceparent) ?? '-'}]`);
    } catch (error) {
      const n = (this.attempts.get(eventId) ?? 0) + 1;
      this.attempts.set(eventId, n);
      if (n >= this.maxAttempts) {
        await this.deadLetter(eventId, marketId, error, n);
        this.attempts.delete(eventId);
        return; // give up → commit offset, don't block the partition
      }
      throw error; // let kafkajs redeliver
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

  private async deadLetter(
    eventId: string,
    marketId: string,
    error: unknown,
    attempts: number,
  ): Promise<void> {
    this.logger.warn(`Dead-lettering event ${eventId} for market ${marketId} after ${attempts}`);
    this.metrics.deadLettered.inc();
    await this.kafka.getProducer().send({
      topic: TOPIC_DLT,
      messages: [
        {
          key: marketId,
          value: JSON.stringify({
            eventId,
            marketId,
            attempts,
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
    });
  }
}
