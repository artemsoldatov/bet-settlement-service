import { Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '../generated/prisma';
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

  // test/support helper: fund a cash account through a real balanced transaction
  async fundCash(accountId: string, amountCents: bigint, currency = 'USD'): Promise<void> {
    const houseId = await this.ensureHouse(currency);
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          type: 'BET_VOID', // reuse a type; deposits are out of scope for the demo
          dedupKey: `deposit:${accountId}:${amountCents}:${Date.now()}`,
          entries: {
            create: [
              { accountId, amountCents, currency },
              { accountId: houseId, amountCents: -amountCents, currency },
            ],
          },
        },
      });
      await tx.account.update({
        where: { id: accountId },
        data: { balanceCents: { increment: amountCents }, version: { increment: 1 } },
      });
      await tx.account.update({
        where: { id: houseId },
        data: { balanceCents: { increment: -amountCents }, version: { increment: 1 } },
      });
    });
  }

  balanceOf(accountId: string): Promise<bigint> {
    return this.prisma.account
      .findUniqueOrThrow({ where: { id: accountId } })
      .then((a) => a.balanceCents);
  }

  // reconciliation: the denormalized balance must equal the sum of its entries
  async isReconciled(accountId: string): Promise<boolean> {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const agg = await this.prisma.ledgerEntry.aggregate({
      where: { accountId },
      _sum: { amountCents: true },
    });
    return (agg._sum.amountCents ?? 0n) === account.balanceCents;
  }
}

export type Tx = Prisma.TransactionClient;
