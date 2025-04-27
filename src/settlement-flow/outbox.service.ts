import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma';

@Injectable()
export class OutboxService {
  /**
   * Writes a domain event to the outbox inside the caller's transaction, so it
   * commits atomically with the state change it announces.
   */
  async emit(
    tx: Prisma.TransactionClient,
    topic: string,
    msgKey: string,
    payload: Prisma.InputJsonValue,
    traceparent: string,
  ): Promise<void> {
    await tx.outboxEvent.create({ data: { topic, msgKey, payload, traceparent } });
  }
}
