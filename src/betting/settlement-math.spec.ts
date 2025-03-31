import { BetOutcome, SelectionResult } from '../generated/prisma';
import { computePayout, outcomeFromResult, settleLines } from './settlement-math';

const acc = { cashId: 'cash', unsettledId: 'uns', houseId: 'house' };

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

  it('produces balanced lines for every outcome', () => {
    for (const outcome of [BetOutcome.WIN, BetOutcome.LOSE, BetOutcome.PUSH, BetOutcome.VOID]) {
      const payout = computePayout(outcome, 100n, 3n, 1n);
      const lines = settleLines(outcome, 100n, payout, acc);
      const sum = lines.reduce((a, l) => a + l.amountCents, 0n);
      expect(sum).toBe(0n);
    }
  });

  it('always books the house side to the single HOUSE account', () => {
    const win = settleLines(BetOutcome.WIN, 100n, 300n, acc);
    const lose = settleLines(BetOutcome.LOSE, 100n, 0n, acc);
    expect(win.find((l) => l.accountId === acc.houseId)?.amountCents).toBe(-200n);
    expect(lose.find((l) => l.accountId === acc.houseId)?.amountCents).toBe(100n);
  });
});
