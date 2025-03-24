import { BetOutcome, SelectionResult } from '../generated/prisma';
import { computePayout, outcomeFromResult } from './settlement-math';

describe('settlement math', () => {
  it('maps selection results to outcomes and rejects pending', () => {
    expect(outcomeFromResult(SelectionResult.WIN)).toBe(BetOutcome.WIN);
    expect(() => outcomeFromResult(SelectionResult.PENDING)).toThrow('still pending');
  });

  it('computes payout with floor division favouring the house', () => {
    // stake 100 at odds 5/2 = 2.5 → 250
    expect(computePayout(BetOutcome.WIN, 100n, 5n, 2n)).toBe(250n);
    // stake 101 at odds 5/3 → 168 (floor of 168.33)
    expect(computePayout(BetOutcome.WIN, 101n, 5n, 3n)).toBe(168n);
    expect(computePayout(BetOutcome.LOSE, 100n, 2n, 1n)).toBe(0n);
    expect(computePayout(BetOutcome.PUSH, 100n, 2n, 1n)).toBe(100n);
  });
});
