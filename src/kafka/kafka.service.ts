import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, Producer } from 'kafkajs';
import type { Env } from '../config/env';
import { ALL_TOPICS } from './topics';

/**
 * Owns the Kafka (Redpanda) client. Connections are lazy — nothing talks to the
 * broker until connect() is called — so components that don't use Kafka (and
 * tests that don't need it) never open a socket.
 */
@Injectable()
export class KafkaService {
  private readonly logger = new Logger(KafkaService.name);
  private readonly kafka: Kafka;
  private producer?: Producer;

  constructor(config: ConfigService<Env, true>) {
    this.kafka = new Kafka({
      clientId: 'bet-settlement',
      brokers: config.get('KAFKA_BROKERS', { infer: true }).split(','),
      logLevel: 1, // errors only
    });
  }

  async connectProducer(): Promise<void> {
    if (this.producer) {
      return;
    }
    // idempotent producer: retried sends don't duplicate on the broker
    const producer = this.kafka.producer({ idempotent: true });
    await producer.connect();
    this.producer = producer;
  }

  getProducer(): Producer {
    if (!this.producer) {
      throw new Error('Kafka producer is not connected');
    }
    return this.producer;
  }

  createConsumer(groupId: string): Consumer {
    return this.kafka.consumer({ groupId });
  }

  async ensureTopics(): Promise<void> {
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: ALL_TOPICS.map((topic) => ({ topic, numPartitions: 6 })),
        waitForLeaders: true,
      });
    } finally {
      await admin.disconnect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = undefined;
    }
  }
}
