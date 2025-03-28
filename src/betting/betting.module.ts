import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { BettingService } from './betting.service';
import { LedgerService } from './ledger.service';

@Module({
  providers: [AccountsService, LedgerService, BettingService],
  exports: [AccountsService, LedgerService, BettingService],
})
export class BettingModule {}
