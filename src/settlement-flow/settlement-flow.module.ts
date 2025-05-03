import { Module } from '@nestjs/common';
import { BettingModule } from '../betting/betting.module';
import { MarketSettledConsumer } from './market-settled.consumer';
import { MarketsService } from './markets.service';
import { OutboxRelay } from './outbox.relay';
import { OutboxService } from './outbox.service';

@Module({
  imports: [BettingModule],
  providers: [OutboxService, OutboxRelay, MarketsService, MarketSettledConsumer],
  exports: [OutboxService, OutboxRelay, MarketsService, MarketSettledConsumer],
})
export class SettlementFlowModule {}
