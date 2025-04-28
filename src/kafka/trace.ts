import { randomBytes } from 'node:crypto';

// Minimal W3C Trace Context. We generate a traceparent at the domain boundary
// and carry it through the outbox and the Kafka message headers, so a settle
// that spans producer and consumer shares one trace id. A full OpenTelemetry
// exporter can consume these headers without changing the propagation.
export function newTraceparent(): string {
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  return `00-${traceId}-${spanId}-01`;
}

export function traceIdOf(traceparent: string | undefined): string | undefined {
  if (!traceparent) {
    return undefined;
  }
  const parts = traceparent.split('-');
  return parts.length === 4 ? parts[1] : undefined;
}
