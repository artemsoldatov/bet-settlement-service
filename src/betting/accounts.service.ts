import { Injectable } from '@nestjs/common';
import { AccountType } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

export interface WalletAccounts {
  walletId: string;
  cashId: string;
  unsettledId: string;
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  // creates the wallet with its cash + unsettled accounts if missing
  async ensureWallet(userId: string, currency = 'USD'): Promise<WalletAccounts> {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId_currency: { userId, currency } },
      create: {
        userId,
        currency,
        accounts: {
          create: [
            { type: AccountType.USER_CASH, currency },
            { type: AccountType.USER_UNSETTLED, currency },
          ],
        },
      },
      update: {},
      include: { accounts: true },
    });

    const cash = wallet.accounts.find((a) => a.type === AccountType.USER_CASH);
    const unsettled = wallet.accounts.find((a) => a.type === AccountType.USER_UNSETTLED);
    if (!cash || !unsettled) {
      throw new Error('Wallet is missing its ledger accounts');
    }
    return { walletId: wallet.id, cashId: cash.id, unsettledId: unsettled.id };
  }

  // single house P&L account per currency (wallet_id is null)
  async ensureHouse(currency = 'USD'): Promise<string> {
    const existing = await this.prisma.account.findFirst({
      where: { walletId: null, type: AccountType.HOUSE, currency },
    });
    if (existing) {
      return existing.id;
    }
    const created = await this.prisma.account.create({
      data: { walletId: null, type: AccountType.HOUSE, currency },
    });
    return created.id;
  }
}
