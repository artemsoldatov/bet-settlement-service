import { Module } from '@nestjs/common';
import { MarketsService } from './markets.service';
import { OutboxRelay } from './outbox.relay';
import { OutboxService } from './outbox.service';

@Module({
  providers: [OutboxService, OutboxRelay, MarketsService],
  exports: [OutboxService, OutboxRelay, MarketsService],
})
export class SettlementFlowModule {}
