import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { BettingModule } from './betting/betting.module';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { KafkaModule } from './kafka/kafka.module';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettlementFlowModule } from './settlement-flow/settlement-flow.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
        genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    PrismaModule,
    KafkaModule,
    ObservabilityModule,
    HealthModule,
    BettingModule,
    SettlementFlowModule,
  ],
})
export class AppModule {}
