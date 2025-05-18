# bet-settlement-service

Exactly-once bet settlement on a double-entry ledger that survives duplicates, concurrent settles, and partial failures.

## Metrics

GET /metrics exposes Prometheus metrics: bets_placed_total, bets_settled_total by outcome, settle_duration_seconds, events_dead_lettered_total, events_duplicates_skipped_total, plus the usual process defaults. A ready-to-import dashboard lives in grafana/dashboard.json.

## Load numbers

bench/loadtest.ts drives the service against a local Postgres and prints measured throughput, no external tool needed. Run pnpm bench to get numbers on your own hardware.
