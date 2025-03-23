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
