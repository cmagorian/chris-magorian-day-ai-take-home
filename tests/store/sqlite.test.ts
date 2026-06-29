import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemberAlreadyDrewError, ValidationError } from '../../src/domain/errors';
import { SqliteFamilyStore } from '../../src/store/SqliteFamilyStore';

const META = { seed: 7, drawnAt: '2026-12-01T00:00:00.000Z' };

describe('SqliteFamilyStore', () => {
  let store: SqliteFamilyStore;

  beforeEach(() => {
    // In-memory DB → fast and fully isolated per test.
    store = new SqliteFamilyStore(':memory:');
  });

  afterEach(() => store.close());

  it('round-trips a family with members and relationships', () => {
    const created = store.createFamily({
      name: 'Smiths',
      members: [{ name: 'Al' }, { name: 'Bea' }, { name: 'Cy' }],
      relationships: [{ fromIndex: 0, toIndex: 1, type: 'spouse' }],
    });

    const fetched = store.getFamily(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Smiths');
    expect(fetched!.members.map((m) => m.name).sort()).toEqual(['Al', 'Bea', 'Cy']);
    expect(fetched!.relationships).toHaveLength(1);
    expect(fetched!.relationships[0].type).toBe('spouse');
  });

  it('returns null for an unknown family', () => {
    expect(store.getFamily('nope')).toBeNull();
  });

  it('rejects relationships that reference an out-of-range member', () => {
    expect(() =>
      store.createFamily({
        name: 'Bad',
        members: [{ name: 'A' }, { name: 'B' }],
        relationships: [{ fromIndex: 0, toIndex: 9, type: 'spouse' }],
      }),
    ).toThrow(ValidationError);
  });

  it('records draws and reads them back via getExchange and listExchanges', () => {
    const fam = store.createFamily({ name: 'F', members: [{ name: 'A' }, { name: 'B' }] });
    const [a, b] = fam.members;
    store.recordDraws(
      fam.id,
      2026,
      [
        { giverId: a.id, receiverId: b.id },
        { giverId: b.id, receiverId: a.id },
      ],
      META,
    );

    const exchange = store.getExchange(fam.id, 2026);
    expect(exchange).not.toBeNull();
    expect(exchange!.year).toBe(2026);
    expect(exchange!.assignments).toHaveLength(2);

    const log = store.listExchanges(fam.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(exchange);
  });

  it('appends draws incrementally into the same exchange', () => {
    const fam = store.createFamily({ name: 'F', members: [{ name: 'A' }, { name: 'B' }] });
    const [a, b] = fam.members;
    store.recordDraws(fam.id, 2026, [{ giverId: a.id, receiverId: b.id }], META);
    expect(store.getExchange(fam.id, 2026)!.assignments).toHaveLength(1);

    store.recordDraws(fam.id, 2026, [{ giverId: b.id, receiverId: a.id }], META);
    expect(store.getExchange(fam.id, 2026)!.assignments).toHaveLength(2);
    expect(store.listExchanges(fam.id)).toHaveLength(1); // still one exchange
  });

  it('lets a member draw at most once per exchange (UNIQUE exchange_id, giver_id)', () => {
    const fam = store.createFamily({ name: 'F', members: [{ name: 'A' }, { name: 'B' }] });
    const [a, b] = fam.members;
    store.recordDraws(fam.id, 2026, [{ giverId: a.id, receiverId: b.id }], META);
    expect(() =>
      store.recordDraws(fam.id, 2026, [{ giverId: a.id, receiverId: b.id }], META),
    ).toThrow(MemberAlreadyDrewError);
  });

  it('returns null for a year with no exchange', () => {
    const fam = store.createFamily({ name: 'F', members: [{ name: 'A' }, { name: 'B' }] });
    expect(store.getExchange(fam.id, 1999)).toBeNull();
  });
});
