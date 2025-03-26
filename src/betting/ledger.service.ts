import { Injectable } from '@nestjs/common';
import { Prisma, TxType } from '../generated/prisma';

export interface LedgerLine {
  accountId: string;
  amountCents: bigint;
}

export interface PostParams {
  type: TxType;
  betId?: string;
  dedupKey: string;
  currency?: string;
  lines: LedgerLine[];
}

@Injectable()
export class LedgerService {
  /**
   * Posts one balanced double-entry transaction inside the caller's tx. The
   * signed lines must sum to zero. The unique dedup key makes the post
   * exactly-once — a replay returns 'duplicate' instead of double-applying.
   */
  async post(tx: Prisma.TransactionClient, params: PostParams): Promise<'ok' | 'duplicate'> {
    const currency = params.currency ?? 'USD';
    const sum = params.lines.reduce((acc, line) => acc + line.amountCents, 0n);
    if (sum !== 0n) {
      throw new Error(`Ledger transaction ${params.dedupKey} does not balance: sum=${sum}`);
    }

    try {
      await tx.transaction.create({
        data: {
          type: params.type,
          betId: params.betId ?? null,
          dedupKey: params.dedupKey,
          entries: {
            create: params.lines.map((line) => ({
              accountId: line.accountId,
              amountCents: line.amountCents,
              currency,
            })),
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'duplicate';
      }
      throw error;
    }

    for (const line of params.lines) {
      await tx.account.update({
        where: { id: line.accountId },
        data: { balanceCents: { increment: line.amountCents }, version: { increment: 1 } },
      });
    }

    return 'ok';
  }
}
