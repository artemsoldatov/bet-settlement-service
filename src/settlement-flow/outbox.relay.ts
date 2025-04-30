import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { KafkaService } from '../kafka/kafka.service';
import { PrismaService } from '../prisma/prisma.service';

interface OutboxRow {
  id: string;
  topic: string;
  msg_key: string;
  payload: unknown;
  traceparent: string | null;
}

/**
 * Drains unpublished outbox rows into Kafka. FOR UPDATE SKIP LOCKED lets several
 * relays run without fighting over rows. Delivery is at-least-once: the outbox
 * row id travels as the `eventId` header, and the consumer's inbox deduplicates
 * on it, so a crash between the send and the mark is safe.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly pollMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
    config: ConfigService<Env, true>,
  ) {
    this.pollMs = config.get('OUTBOX_POLL_MS', { infer: true });
  }

  startDaemon(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => this.logger.error(String(error)));
    }, this.pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async tick(batchSize = 100): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, topic, msg_key, payload, traceparent FROM outbox_events
          WHERE published_at IS NULL
          ORDER BY created_at ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) {
          return 0;
        }

        const producer = this.kafka.getProducer();
        for (const row of rows) {
          await producer.send({
            topic: row.topic,
            messages: [
              {
                key: row.msg_key,
                value: JSON.stringify(row.payload),
                headers: {
                  eventId: row.id,
                  traceparent: row.traceparent ?? '',
                },
              },
            ],
          });
        }

        await tx.outboxEvent.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { publishedAt: new Date() },
        });
        return rows.length;
      });
    } finally {
      this.running = false;
    }
  }
}
