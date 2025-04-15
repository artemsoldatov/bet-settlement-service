import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import type { Env } from '../config/env';

/**
 * Owns the Kafka (Redpanda) client. Connections are lazy — nothing talks to the
 * broker until connect() is called — so components that don't use Kafka (and
 * tests that don't need it) never open a socket.
 */
@Injectable()
export class KafkaService {
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

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = undefined;
    }
  }
}
