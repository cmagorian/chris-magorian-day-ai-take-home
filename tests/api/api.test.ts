import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/api/server';
import { SqliteFamilyStore } from '../../src/store/SqliteFamilyStore';

describe('HTTP API', () => {
  let store: SqliteFamilyStore;
  let notify: ReturnType<typeof vi.fn>;
  let app: express.Express;

  beforeEach(() => {
    store = new SqliteFamilyStore(':memory:');
    notify = vi.fn();
    app = createApp({ store, notify });
  });

  afterEach(() => store.close());

  const createFamily = () =>
    request(app)
      .post('/families')
      .send({
        name: 'Holidays',
        members: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
      });

  it('health check responds', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
  });

  it('creates a family and returns generated ids', async () => {
    const res = await createFamily().expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.members).toHaveLength(3);
    expect(res.body.members[0].id).toBeTruthy();
  });

  it('rejects an invalid family (too few members)', async () => {
    const res = await request(app)
      .post('/families')
      .send({ name: 'Tiny', members: [{ name: 'Solo' }] })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown family', async () => {
    await request(app).get('/families/does-not-exist').expect(404);
  });

  it('returns 400 (not 500) for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/families')
      .set('content-type', 'application/json')
      .send('{ "name": ')
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('draws an exchange, notifies once, and is idempotent on re-draw', async () => {
    const { body: family } = await createFamily();

    const first = await request(app)
      .post(`/families/${family.id}/exchanges`)
      .send({ year: 2026, seed: 42 })
      .expect(201);
    expect(first.body.assignments).toHaveLength(3);
    expect(notify).toHaveBeenCalledTimes(1);

    // Re-drawing the same year returns the SAME result and does not re-notify.
    const second = await request(app)
      .post(`/families/${family.id}/exchanges`)
      .send({ year: 2026, seed: 999 })
      .expect(200);
    expect(second.body).toEqual(first.body);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('lists the exchange history', async () => {
    const { body: family } = await createFamily();
    await request(app).post(`/families/${family.id}/exchanges`).send({ year: 2026 }).expect(201);

    const res = await request(app).get(`/families/${family.id}/exchanges`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].year).toBe(2026);
  });

  it('returns 404 when drawing for an unknown family', async () => {
    await request(app).post('/families/ghost/exchanges').send({ year: 2026 }).expect(404);
  });

  it('returns 400 for an invalid exchange body', async () => {
    const { body: family } = await createFamily();
    await request(app).post(`/families/${family.id}/exchanges`).send({}).expect(400);
  });

  it('returns 422 when no valid assignment exists', async () => {
    // Two spouses: the only non-self pairing is forbidden by the immediate-family rule.
    const { body: family } = await request(app)
      .post('/families')
      .send({
        name: 'Couple',
        members: [{ name: 'A' }, { name: 'B' }],
        relationships: [{ fromIndex: 0, toIndex: 1, type: 'spouse' }],
      })
      .expect(201);

    const res = await request(app)
      .post(`/families/${family.id}/exchanges`)
      .send({ year: 2026 })
      .expect(422);
    expect(res.body.code).toBe('NO_VALID_ASSIGNMENT');
  });

  describe('per-person draw', () => {
    it('lets a member draw their own Secret Santa, notifying just them', async () => {
      const { body: family } = await createFamily();
      const memberId = family.members[0].id;

      const res = await request(app)
        .post(`/families/${family.id}/members/${memberId}/draws`)
        .send({ year: 2026, seed: 5 })
        .expect(201);

      expect(res.body.giverId).toBe(memberId);
      expect(res.body.receiverId).not.toBe(memberId);
      expect(res.body.complete).toBe(false); // only one of three has drawn
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('is idempotent for a member and reports completion on the last draw', async () => {
      const { body: family } = await createFamily();
      const ids = family.members.map((m: { id: string }) => m.id);

      const draw = (id: string) =>
        request(app).post(`/families/${family.id}/members/${id}/draws`).send({ year: 2026 });

      const first = await draw(ids[0]).expect(201);
      const repeat = await draw(ids[0]).expect(200); // already drew → 200, no re-notify
      expect(repeat.body.receiverId).toBe(first.body.receiverId);

      await draw(ids[1]).expect(201);
      const last = await draw(ids[2]).expect(201);
      expect(last.body.complete).toBe(true);
      expect(notify).toHaveBeenCalledTimes(3); // one per fresh draw, not the repeat
    });

    it('returns 404 for an unknown member', async () => {
      const { body: family } = await createFamily();
      await request(app)
        .post(`/families/${family.id}/members/nope/draws`)
        .send({ year: 2026 })
        .expect(404);
    });
  });

  describe('reading a member draw', () => {
    it('returns only the member’s own receiver for a year (not the whole mapping)', async () => {
      const { body: family } = await createFamily();
      const memberId = family.members[0].id;
      await request(app).post(`/families/${family.id}/exchanges`).send({ year: 2026 }).expect(201);

      const res = await request(app)
        .get(`/families/${family.id}/members/${memberId}/draws`)
        .query({ year: 2026 })
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual(['familyId', 'giverId', 'receiverId', 'year']);
      expect(res.body.giverId).toBe(memberId);
      expect(res.body.receiverId).not.toBe(memberId);
    });

    it('returns 404 DRAW_NOT_FOUND when the member has not drawn that year', async () => {
      const { body: family } = await createFamily();
      const res = await request(app)
        .get(`/families/${family.id}/members/${family.members[0].id}/draws`)
        .query({ year: 2026 })
        .expect(404);
      expect(res.body.code).toBe('DRAW_NOT_FOUND');
    });

    it('lists a member’s draws across years when no year is given', async () => {
      const { body: family } = await createFamily();
      const memberId = family.members[0].id;
      await request(app).post(`/families/${family.id}/exchanges`).send({ year: 2025 }).expect(201);
      await request(app).post(`/families/${family.id}/exchanges`).send({ year: 2026 }).expect(201);

      const res = await request(app)
        .get(`/families/${family.id}/members/${memberId}/draws`)
        .expect(200);

      expect(res.body.map((d: { year: number }) => d.year)).toEqual([2025, 2026]);
      expect(res.body.every((d: { giverId: string }) => d.giverId === memberId)).toBe(true);
    });

    it('returns an empty list for a member who has never drawn', async () => {
      const { body: family } = await createFamily();
      await request(app)
        .post(`/families/${family.id}/members/${family.members[0].id}/draws`)
        .send({ year: 2026 })
        .expect(201);

      const res = await request(app)
        .get(`/families/${family.id}/members/${family.members[1].id}/draws`)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('returns 404 for an unknown family or member', async () => {
      const { body: family } = await createFamily();
      await request(app).get('/families/ghost/members/x/draws').expect(404);
      await request(app).get(`/families/${family.id}/members/nope/draws`).expect(404);
    });

    it('returns 400 for a non-numeric year', async () => {
      const { body: family } = await createFamily();
      await request(app)
        .get(`/families/${family.id}/members/${family.members[0].id}/draws`)
        .query({ year: 'abc' })
        .expect(400);
    });
  });
});
