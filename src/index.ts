import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './api/server';
import { logger } from './logger';
import { loggingNotifier, notifyParticipants, type ExchangeNotification } from './notifier';
import { SqliteFamilyStore } from './store/SqliteFamilyStore';

const PORT = Number(process.env.PORT ?? 3000);
const DB_FILE = process.env.DB_FILE ?? 'data/secret-santa.db';

// Ensure the directory for the SQLite file exists before opening it.
mkdirSync(dirname(DB_FILE), { recursive: true });

const store = new SqliteFamilyStore(DB_FILE);

// Best-effort: the draw is already committed before this runs, so a notifier failure is
// logged, not propagated — we don't fail a persisted draw because an email bounced.
const notify = async (data: ExchangeNotification) => {
  try {
    await notifyParticipants(loggingNotifier, data);
  } catch (err) {
    logger.warn(
      { err, familyId: data.familyId, year: data.year },
      'Notification hook failed; draw is already persisted',
    );
  }
};

const app = createApp({ store, notify });

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, db: DB_FILE }, 'Secret Santa service listening');
});

// Stop accepting connections, let in-flight requests drain, close the DB, exit. The 10s
// timer is the safety net for connections that never drain (.unref() so it can't hang exit).
const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    store.close();
    process.exit(0);
  });
  // Safety net if connections refuse to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
