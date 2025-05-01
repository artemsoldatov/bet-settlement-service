export const TOPIC_MARKET_SETTLED = 'markets.settled';
export const TOPIC_DLT = 'markets.settled.dlt';

export const ALL_TOPICS = [TOPIC_MARKET_SETTLED, TOPIC_DLT];

// topic -> the outbox topic name written by the domain; kept explicit so the
// relay stays generic
export const OUTBOX_TOPIC_MARKET_SETTLED = 'market.settled';
