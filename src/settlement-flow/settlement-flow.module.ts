import { Module } from '@nestjs/common';
import { MarketsService } from './markets.service';
import { OutboxService } from './outbox.service';

@Module({
  providers: [OutboxService, MarketsService],
  exports: [OutboxService, MarketsService],
})
export class SettlementFlowModule {}
