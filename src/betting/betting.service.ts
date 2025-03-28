import { Injectable } from '@nestjs/common';
import { Bet, BetStatus, Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';

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
            { accountId: input.cashId, amountCents: -input.stakeCents },
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
}
