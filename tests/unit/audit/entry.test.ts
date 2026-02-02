import { afterEach, describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import {
  auditActions,
  checkEntry,
  countByAction,
  describeEntry,
  entriesBy,
  entriesFor,
  isAuditAction,
  makeEntry,
  needsReason,
} from '../../../src/domain/audit/entry';
import { migrate } from '../../../src/storage/migrate';
import {
  entryCount,
  lastEntries,
  record,
  trailBetween,
  trailBy,
  trailFor,
} from '../../../src/storage/audit-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

const T = parseInstant('2025-05-01T09:00Z');

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

function entry(
  overrides: Partial<Parameters<typeof makeEntry>[0]> = {},
): ReturnType<typeof makeEntry> {
  return makeEntry({
    at: T,
    action: 'movement-replanned',
    subject: 'M-2025-0004',
    by: 'despatcher.hall',
    note: 'the ship missed the tide',
    ...overrides,
  });
}

describe('an entry', () => {
  it('keeps what it was given', () => {
    const one = entry();
    expect(one.action).toBe('movement-replanned');
    expect(one.by).toBe('despatcher.hall');
    expect(one.note).toBe('the ship missed the tide');
  });

  it('refuses an action nobody audits', () => {
    expect(() => entry({ action: 'tea-break' })).toThrow(/not an audited action/);
    expect(isAuditAction('order-placed')).toBe(true);
    expect(isAuditAction('nonsense')).toBe(false);
    expect(auditActions().length).toBeGreaterThan(10);
  });

  it('refuses one with nobody or nothing on it', () => {
    expect(() => entry({ subject: '  ' })).toThrow(/needs a subject/);
    expect(() => entry({ by: '' })).toThrow(InputError);
  });

  it('takes a detail and copies it', () => {
    const detail = { from: 100, to: 200 };
    const one = entry({ detail });
    detail.to = 0;
    expect(one.detail).toEqual({ from: 100, to: 200 });
  });

  it('says which actions want a reason', () => {
    expect(needsReason('board-overridden')).toBe(true);
    expect(needsReason('order-placed')).toBe(false);
    expect(checkEntry(entry())).toEqual([]);
    expect(checkEntry(entry({ note: '' }))[0]).toContain('no reason');
  });

  it('describes itself in a line', () => {
    expect(describeEntry(entry())).toBe(
      'movement-replanned M-2025-0004 by despatcher.hall: the ship missed the tide',
    );
    expect(describeEntry(entry({ action: 'order-placed', note: '' }))).toBe(
      'order-placed M-2025-0004 by despatcher.hall',
    );
  });

  it('groups and filters', () => {
    const entries = [
      entry(),
      entry({ action: 'order-placed', subject: 'M-2025-0005', by: 'agent.seaway', note: '' }),
      entry({ action: 'order-placed', subject: 'M-2025-0004', by: 'agent.seaway', note: '' }),
    ];
    expect(entriesFor(entries, 'M-2025-0004')).toHaveLength(2);
    expect(entriesBy(entries, 'agent.seaway')).toHaveLength(2);
    expect(countByAction(entries)).toEqual({ 'movement-replanned': 1, 'order-placed': 2 });
  });
});

describe('the trail on disk', () => {
  function ready(): TempDatabase {
    temp = temporaryDatabase();
    migrate(temp.db);
    return temp;
  }

  it('comes back as it went in', () => {
    const one = ready();
    record(one.db, entry());
    expect(trailFor(one.db, 'M-2025-0004')).toEqual([entry()]);
  });

  it('keeps the detail through the round trip', () => {
    const one = ready();
    record(one.db, entry({ detail: { from: 100, to: 200 } }));
    expect(trailFor(one.db, 'M-2025-0004')[0]?.detail).toEqual({ from: 100, to: 200 });
  });

  it('appends rather than replacing', () => {
    const one = ready();
    record(one.db, entry());
    record(one.db, entry({ note: 'and again' }));
    expect(trailFor(one.db, 'M-2025-0004')).toHaveLength(2);
    expect(entryCount(one.db)).toBe(2);
  });

  it('reads by period and by person', () => {
    const one = ready();
    record(one.db, entry());
    record(one.db, entry({ at: T + 10000, by: 'agent.seaway', action: 'order-placed', note: '' }));
    expect(trailBetween(one.db, T - 100, T + 100)).toHaveLength(1);
    expect(trailBy(one.db, 'agent.seaway')).toHaveLength(1);
  });

  it('reads the last few, oldest first', () => {
    const one = ready();
    for (let index = 0; index < 5; index += 1) {
      record(one.db, entry({ at: T + index, note: `entry ${index}` }));
    }
    const last = lastEntries(one.db, 3);
    expect(last).toHaveLength(3);
    expect(last[0]?.note).toBe('entry 2');
    expect(last[2]?.note).toBe('entry 4');
  });
});
