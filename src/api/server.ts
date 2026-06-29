import express, { type Express } from 'express';
import pinoHttp from 'pino-http';
import { logger } from '../logger';
import type { ExchangeNotification } from '../notifier';
import type { FamilyStore } from '../store/FamilyStore';
import { errorHandler } from './errorHandler';
import { createRoutes } from './routes';

export interface AppDeps {
  store: FamilyStore;
  /** Notification hook fired after a fresh draw (stub in prod, a spy in tests). */
  notify: (data: ExchangeNotification) => Promise<void> | void;
}

// Factory, no module-level singletons, so tests get an isolated app with an in-memory store.
// Order matters: body parse → logging → health → routes → error handler (last, so it catches
// everything forwarded via next(err)).
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  // Liveness / readiness for container orchestrators.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', (_req, res) => res.json({ status: 'ready' }));

  app.use(createRoutes({ store: deps.store, notify: deps.notify }));
  app.use(errorHandler);

  return app;
}
