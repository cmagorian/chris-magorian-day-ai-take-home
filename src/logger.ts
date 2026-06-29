import pino from 'pino';

/**
 * Single shared structured logger. JSON logs play nicely with aggregation systems; set
 * `LOG_LEVEL` to tune verbosity and `silent` in tests to keep output clean.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
});
