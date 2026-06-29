import { Router, type Request, type Response, type NextFunction } from 'express';
import { drawExchange, drawForMember, getMemberDraw, listMemberDraws } from '../exchangeService';
import { FamilyNotFoundError } from '../domain/errors';
import type { ExchangeNotification } from '../notifier';
import type { FamilyStore } from '../store/FamilyStore';
import { createExchangeSchema, createFamilySchema, memberDrawsQuerySchema } from './schemas';

export interface RouteDeps {
  store: FamilyStore;
  /** Notification hook fired after a fresh draw (stub in prod, a spy in tests). */
  notify: (data: ExchangeNotification) => Promise<void> | void;
}

// Funnels sync throws and rejected promises into next(), so handlers can just throw and the
// central error middleware does the rest. Express 4 doesn't catch async rejections itself.
const wrap =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

// Factory (not a singleton) so tests can mount it with an in-memory store and a spy notifier.
export function createRoutes(deps: RouteDeps): Router {
  const router = Router();
  const { store } = deps;

  // Create a family.
  router.post(
    '/families',
    wrap((req, res) => {
      const input = createFamilySchema.parse(req.body);
      const family = store.createFamily(input);
      res.status(201).json(family);
    }),
  );

  router.get(
    '/families/:id',
    wrap((req, res) => {
      const family = store.getFamily(req.params.id);
      if (!family) throw new FamilyNotFoundError(req.params.id);
      res.json(family);
    }),
  );

  // Bulk draw for the year. 201 if it recorded anything (and notifies only those), 200 if the
  // year was already complete.
  router.post(
    '/families/:id/exchanges',
    wrap(async (req, res) => {
      const familyId = req.params.id;
      const { year, seed } = createExchangeSchema.parse(req.body);

      const { event, newAssignments } = drawExchange(store, familyId, year, { seed });
      const created = newAssignments.length > 0;
      if (created) {
        await deps.notify({ familyId, year, assignments: newAssignments });
      }

      res.status(created ? 201 : 200).json(event);
    }),
  );

  // One person draws their own Santa. 201 + the pairing on a fresh draw (notifies that giver),
  // 200 if they'd already drawn.
  router.post(
    '/families/:id/members/:memberId/draws',
    wrap(async (req, res) => {
      const familyId = req.params.id;
      const memberId = req.params.memberId;
      const { year, seed } = createExchangeSchema.parse(req.body);

      const { assignment, created, complete } = drawForMember(store, familyId, memberId, year, {
        seed,
      });
      if (created) {
        await deps.notify({ familyId, year, assignments: [assignment] });
      }

      res.status(created ? 201 : 200).json({
        familyId,
        year,
        giverId: assignment.giverId,
        receiverId: assignment.receiverId,
        complete,
      });
    }),
  );

  // Reveal a member's own draw. ?year=YYYY → just that year's receiver (404 if not drawn yet);
  // no year → the member's draw history. Only their own receiver is returned, so reading it
  // never leaks the rest of the family's pairings.
  router.get(
    '/families/:id/members/:memberId/draws',
    wrap((req, res) => {
      const familyId = req.params.id;
      const memberId = req.params.memberId;
      const { year } = memberDrawsQuerySchema.parse(req.query);

      if (year === undefined) {
        res.json(listMemberDraws(store, familyId, memberId));
        return;
      }
      res.json(getMemberDraw(store, familyId, memberId, year));
    }),
  );

  // Exchange history, oldest year first.
  router.get(
    '/families/:id/exchanges',
    wrap((req, res) => {
      const familyId = req.params.id;
      if (!store.getFamily(familyId)) throw new FamilyNotFoundError(familyId);
      res.json(store.listExchanges(familyId));
    }),
  );

  return router;
}
