# bet-settlement-service

Exactly-once bet settlement on a double-entry ledger that survives duplicates, concurrent settles, and partial failures.

Placing a bet freezes the stake, settling it pays the outcome, and voiding a settled bet reverses it with compensating entries, all on a double-entry ledger where every transaction sums to zero. The exactly-once guarantee lives in Postgres constraints rather than application logic: a concurrent identical place returns the original bet instead of creating a second one, a concurrent settle race only books the payout once, and a floored conditional debit means no account can ever overdraw.

Placing a bet moves money from USER_CASH to USER_UNSETTLED atomically, with an idempotent debit that can't overdraw. Settling looks at the selection's result: a win pays out, a loss takes the stake, a push or void refunds it, and the house side always sits on one HOUSE account. Voiding a settled bet reverses it with append-only compensating entries rather than editing history.

Markets also settle over Kafka. A transactional outbox relays events, an inbox keyed by event id turns at-least-once delivery into an effectively-once effect, and a dead-letter topic catches poison events instead of letting them block the partition forever. Money is stored as integer minor units (BIGINT) and odds as exact fractions, so no float ever touches a balance.

A W3C traceparent gets generated at the domain boundary and carried through the outbox row and the Kafka message headers, so the producer and consumer end up sharing one trace id.

## Metrics

GET /metrics exposes Prometheus metrics: bets_placed_total, bets_settled_total by outcome, settle_duration_seconds, events_dead_lettered_total, events_duplicates_skipped_total, plus the usual process defaults. A ready-to-import dashboard lives in grafana/dashboard.json.

## Load numbers

bench/loadtest.ts drives the service against a local Postgres and prints measured throughput, no external tool needed. Run pnpm bench to get numbers on your own hardware.

## Stack

NestJS 11 on Fastify, TypeScript 5 in strict mode, Prisma 6, PostgreSQL 16, Kafka via Redpanda and kafkajs, prom-client for metrics, Jest with Testcontainers, GitHub Actions for CI.

## Running it

```bash
docker compose up -d          # Postgres 16 (55435) + Redpanda (59092)
pnpm install
pnpm prisma:generate
pnpm migrate:dev
pnpm test                     # unit: settlement math
pnpm test:e2e                 # money-core concurrency + Kafka flow on real infra (Testcontainers)
pnpm bench                    # measured load numbers
pnpm start:dev                # runs the relay daemon + settle consumer; /metrics on :53001
```
