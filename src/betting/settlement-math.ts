import { BetOutcome, SelectionResult } from '../generated/prisma';
import { InvalidBetStateError } from './errors';

export function outcomeFromResult(result: SelectionResult): BetOutcome {
  switch (result) {
    case SelectionResult.WIN:
      return BetOutcome.WIN;
    case SelectionResult.LOSE:
      return BetOutcome.LOSE;
    case SelectionResult.PUSH:
      return BetOutcome.PUSH;
    case SelectionResult.VOID:
      return BetOutcome.VOID;
    default:
      throw new InvalidBetStateError('Selection is still pending; cannot settle');
  }
}

// integer minor units only; floor division favours the house, fixed by test
export function computePayout(
  outcome: BetOutcome,
  stakeCents: bigint,
  oddsNum: bigint,
  oddsDen: bigint,
): bigint {
  switch (outcome) {
    case BetOutcome.WIN:
      return (stakeCents * oddsNum) / oddsDen;
    case BetOutcome.PUSH:
    case BetOutcome.VOID:
      return stakeCents; // stake refunded
    case BetOutcome.LOSE:
      return 0n;
  }
}

export interface SettleAccounts {
  cashId: string;
  unsettledId: string;
  houseId: string;
}

export interface Line {
  accountId: string;
  amountCents: bigint;
}

/**
 * The double-entry lines for settling a bet. Every case sums to zero and the
 * house side is always the single HOUSE account, so house P&L is one SUM.
 */
export function settleLines(
  outcome: BetOutcome,
  stakeCents: bigint,
  payoutCents: bigint,
  acc: SettleAccounts,
): Line[] {
  switch (outcome) {
    case BetOutcome.WIN:
      return [
        { accountId: acc.unsettledId, amountCents: -stakeCents },
        { accountId: acc.cashId, amountCents: payoutCents },
        { accountId: acc.houseId, amountCents: stakeCents - payoutCents },
      ];
    case BetOutcome.LOSE:
      return [
        { accountId: acc.unsettledId, amountCents: -stakeCents },
        { accountId: acc.houseId, amountCents: stakeCents },
      ];
    case BetOutcome.PUSH:
    case BetOutcome.VOID:
      return [
        { accountId: acc.unsettledId, amountCents: -stakeCents },
        { accountId: acc.cashId, amountCents: stakeCents },
      ];
  }
}
