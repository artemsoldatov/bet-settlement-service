import helmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { KafkaService } from './kafka/kafka.service';
import { MarketSettledConsumer } from './settlement-flow/market-settled.consumer';
import { OutboxRelay } from './settlement-flow/outbox.relay';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  await app.register(helmet);
  app.enableShutdownHooks();

  // start the Kafka settlement flow: producer + topics, outbox relay, consumer
  const kafka = app.get(KafkaService);
  await kafka.connectProducer();
  await kafka.ensureTopics();
  app.get(OutboxRelay).startDaemon();
  await app.get(MarketSettledConsumer).start();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('bet-settlement-service')
    .setDescription('Exactly-once bet settlement on a double-entry ledger')
    .setVersion('0.1')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const config: ConfigService<Env, true> = app.get(ConfigService);
  await app.listen({ port: config.get('PORT', { infer: true }), host: '0.0.0.0' });
}

void bootstrap();
