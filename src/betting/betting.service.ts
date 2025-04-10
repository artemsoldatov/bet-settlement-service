import { Injectable } from '@nestjs/common';
import { AccountType, Bet, BetStatus, Prisma, SettlementStatus } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { InvalidBetStateError } from './errors';
import { LedgerService } from './ledger.service';
import { computePayout, outcomeFromResult, settleLines } from './settlement-math';

export interface PlaceBetInput {
  walletId: string;
  cashId: string;
  unsettledId: string;
  selectionId: string;
  stakeCents: bigint;
  oddsNum: bigint;
  oddsDen: bigint;
  idempotencyKey: string;
  currency?: string;
}

@Injectable()
export class BettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Places a bet: freeze the stake (cash → unsettled) and record the bet, all
   * in one transaction. The bet's unique idempotency key makes a retry return
   * the original bet instead of placing a second one.
   */
  async place(input: PlaceBetInput): Promise<Bet> {
    const currency = input.currency ?? 'USD';
    const potential = (input.stakeCents * input.oddsNum) / input.oddsDen;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.bet.create({
          data: {
            walletId: input.walletId,
            selectionId: input.selectionId,
            stakeCents: input.stakeCents,
            currency,
            oddsNum: input.oddsNum,
            oddsDen: input.oddsDen,
            potentialCents: potential,
            idempotencyKey: input.idempotencyKey,
            status: BetStatus.ACCEPTED,
          },
        });

        await this.ledger.post(tx, {
          type: 'BET_PLACE',
          betId: created.id,
          dedupKey: `place:${created.id}`,
          currency,
          lines: [
            { accountId: input.cashId, amountCents: -input.stakeCents, floor: true },
            { accountId: input.unsettledId, amountCents: input.stakeCents },
          ],
        });

        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // a concurrent/retried place with the same key — return the winner
        return this.prisma.bet.findFirstOrThrow({
          where: { walletId: input.walletId, idempotencyKey: input.idempotencyKey },
        });
      }
      throw error;
    }
  }

  /**
   * Settles a bet by its selection's result. Exactly-once at the money level:
   * the unique settlement row (and the ledger dedup key) make a concurrent or
   * retried settle a no-op, so the payout is booked once.
   */
  async settle(betId: string): Promise<Bet> {
    return this.prisma.$transaction(async (tx) => {
      const bet = await tx.bet.findUnique({
        where: { id: betId },
        include: { selection: true, wallet: { include: { accounts: true } } },
      });
      if (!bet) {
        throw new InvalidBetStateError('Bet not found');
      }
      if (bet.status !== BetStatus.ACCEPTED) {
        return bet; // already settled or void — idempotent no-op
      }

      const outcome = outcomeFromResult(bet.selection.result);
      const payout = computePayout(outcome, bet.stakeCents, bet.oddsNum, bet.oddsDen);

      try {
        await tx.settlement.create({
          data: { betId, marketId: bet.selection.marketId, outcome, payoutCents: payout },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return bet; // already settled by a concurrent writer
        }
        throw error;
      }

      const acc = await this.accountsOf(tx, bet);
      await this.ledger.post(tx, {
        type: 'BET_SETTLE',
        betId,
        dedupKey: `settle:${betId}`,
        currency: bet.currency,
        lines: settleLines(outcome, bet.stakeCents, payout, acc),
      });

      return tx.bet.update({
        where: { id: betId },
        data: {
          status: BetStatus.SETTLED,
          outcome,
          payoutCents: payout,
          settledAt: new Date(),
        },
      });
    });
  }

  /**
   * Reverses a settled bet with compensating entries (never an update to old
   * rows), returning the money to the frozen state and marking the settlement
   * REVERSED. The bet becomes ACCEPTED again, ready to be re-settled.
   */
  async voidSettled(betId: string): Promise<Bet> {
    return this.prisma.$transaction(async (tx) => {
      const bet = await tx.bet.findUnique({
        where: { id: betId },
        include: { settlement: true, wallet: { include: { accounts: true } } },
      });
      if (!bet) {
        throw new InvalidBetStateError('Bet not found');
      }
      if (
        bet.status !== BetStatus.SETTLED ||
        !bet.settlement ||
        bet.settlement.status !== SettlementStatus.APPLIED ||
        bet.outcome === null ||
        bet.payoutCents === null
      ) {
        return bet; // nothing to reverse
      }

      const acc = await this.accountsOf(tx, bet);
      const reversal = settleLines(bet.outcome, bet.stakeCents, bet.payoutCents, acc).map((l) => ({
        accountId: l.accountId,
        amountCents: -l.amountCents,
      }));

      const result = await this.ledger.post(tx, {
        type: 'BET_VOID',
        betId,
        dedupKey: `void:${betId}`,
        currency: bet.currency,
        lines: reversal,
      });
      if (result === 'duplicate') {
        return bet;
      }

      await tx.settlement.update({
        where: { betId },
        data: { status: SettlementStatus.REVERSED },
      });

      return tx.bet.update({
        where: { id: betId },
        data: { status: BetStatus.ACCEPTED, outcome: null, payoutCents: null, settledAt: null },
      });
    });
  }

  private async accountsOf(
    tx: Prisma.TransactionClient,
    bet: {
      currency: string;
      wallet: { accounts: { id: string; type: AccountType }[] };
    },
  ): Promise<{ cashId: string; unsettledId: string; houseId: string }> {
    const cash = bet.wallet.accounts.find((a) => a.type === AccountType.USER_CASH);
    const unsettled = bet.wallet.accounts.find((a) => a.type === AccountType.USER_UNSETTLED);
    if (!cash || !unsettled) {
      throw new InvalidBetStateError('Wallet is missing ledger accounts');
    }
    const house = await tx.account.findFirst({
      where: { walletId: null, type: AccountType.HOUSE, currency: bet.currency },
    });
    if (!house) {
      throw new InvalidBetStateError('House account is not provisioned');
    }
    return { cashId: cash.id, unsettledId: unsettled.id, houseId: house.id };
  }
}
