import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly betsPlaced = new Counter({
    name: 'bets_placed_total',
    help: 'Bets accepted',
    registers: [this.registry],
  });

  readonly betsSettled = new Counter({
    name: 'bets_settled_total',
    help: 'Bets settled by outcome',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  readonly settleDuration = new Histogram({
    name: 'settle_duration_seconds',
    help: 'Time to settle one bet',
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
