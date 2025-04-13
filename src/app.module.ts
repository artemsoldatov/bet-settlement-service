import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BettingModule } from './betting/betting.module';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    HealthModule,
    BettingModule,
  ],
})
export class AppModule {}
