import { afterEach, describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { NotFoundError } from '../../../src/util/errors';
import { makeInterval } from '../../../src/util/interval';
import { makeNotice } from '../../../src/domain/notice/notice';
import type { Notice } from '../../../src/domain/notice/notice';
import { migrate } from '../../../src/storage/migrate';
import {
  findNotice,
  isWithdrawn,
  nextNoticeId,
  noticesInPeriod,
  noticesIssuedSince,
  noticesOn,
  requireNotice,
  saveNotice,
  standingNotices,
  withdrawNotice,
  withdrawnNotices,
} from '../../../src/storage/notice-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

const T = parseInstant('2025-05-01T00:00Z');
const DAY = 1440;

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

function notice(overrides: Partial<Parameters<typeof makeNotice>[0]> = {}): Notice {
  return makeNotice({
    id: 'N-2025-001',
    kind: 'draught-cap',
    subject: 'LOWER-BAR',
    from: T,
    to: T + 7 * DAY,
    text: 'dredger working the bar',
    value: 1150,
    issuedAt: T - DAY,
    ...overrides,
  });
}

function ready(): TempDatabase {
  temp = temporaryDatabase();
  migrate(temp.db);
  return temp;
}

describe('saving and loading', () => {
  it('brings a notice back as it went in', () => {
    const one = ready();
    saveNotice(one.db, notice());
    expect(findNotice(one.db, 'N-2025-001')).toEqual(notice());
  });

  it('leaves a notice with no value without one', () => {
    const one = ready();
    saveNotice(one.db, notice({ kind: 'closure', value: undefined }));
    expect(findNotice(one.db, 'N-2025-001')?.value).toBeUndefined();
  });

  it('updates on a second save', () => {
    const one = ready();
    saveNotice(one.db, notice());
    saveNotice(one.db, notice({ value: 1100 }));
    expect(findNotice(one.db, 'N-2025-001')?.value).toBe(1100);
    expect(standingNotices(one.db)).toHaveLength(1);
  });

  it('refuses one that is not there', () => {
    const one = ready();
    expect(findNotice(one.db, 'N-2025-009')).toBeUndefined();
    expect(() => requireNotice(one.db, 'N-2025-009')).toThrow(NotFoundError);
  });

  it('refuses a kind the schema does not carry', () => {
    const one = ready();
    expect(() =>
      one.db
        .prepare(
          `insert into notice (id, kind, subject, from_at, to_at, body, issued_at)
           values ('N-2025-002', 'rumour', 'UPPER', 1, 2, 'x', 1)`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });
});

describe('finding notices', () => {
  function seeded(): TempDatabase {
    const one = ready();
    saveNotice(one.db, notice());
    saveNotice(
      one.db,
      notice({
        id: 'N-2025-002',
        kind: 'closure',
        subject: 'UPPER',
        from: T + 10 * DAY,
        to: T + 12 * DAY,
        value: undefined,
      }),
    );
    return one;
  }

  it('by the period they could bind on', () => {
    const one = seeded();
    expect(noticesInPeriod(one.db, makeInterval(T, T + DAY)).map((each) => each.id)).toEqual([
      'N-2025-001',
    ]);
    expect(
      noticesInPeriod(one.db, makeInterval(T, T + 20 * DAY)).map((each) => each.id),
    ).toHaveLength(2);
    expect(noticesInPeriod(one.db, makeInterval(T + 30 * DAY, T + 40 * DAY))).toEqual([]);
  });

  it('by subject', () => {
    const one = seeded();
    expect(noticesOn(one.db, 'UPPER').map((each) => each.id)).toEqual(['N-2025-002']);
    expect(noticesOn(one.db, 'NOWHERE')).toEqual([]);
  });

  it('by when they were issued', () => {
    const one = seeded();
    expect(noticesIssuedSince(one.db, T - 2 * DAY)).toHaveLength(2);
    expect(noticesIssuedSince(one.db, T + DAY)).toEqual([]);
  });
});

describe('withdrawing', () => {
  it('takes a notice out of the standing list and leaves it readable', () => {
    const one = ready();
    saveNotice(one.db, notice());
    expect(withdrawNotice(one.db, 'N-2025-001')).toBe(true);
    expect(standingNotices(one.db)).toEqual([]);
    expect(findNotice(one.db, 'N-2025-001')?.text).toBe('dredger working the bar');
    expect(isWithdrawn(one.db, 'N-2025-001')).toBe(true);
    expect(withdrawnNotices(one.db)).toHaveLength(1);
  });

  it('says when there was nothing to withdraw', () => {
    const one = ready();
    expect(withdrawNotice(one.db, 'N-2025-009')).toBe(false);
    expect(isWithdrawn(one.db, 'N-2025-009')).toBe(false);
  });

  it('keeps a withdrawn notice out of the period query', () => {
    const one = ready();
    saveNotice(one.db, notice());
    withdrawNotice(one.db, 'N-2025-001');
    expect(noticesInPeriod(one.db, makeInterval(T, T + DAY))).toEqual([]);
  });
});

describe('numbering', () => {
  it('starts at one and counts the withdrawn ones', () => {
    const one = ready();
    expect(nextNoticeId(one.db, 2025)).toBe('N-2025-001');
    saveNotice(one.db, notice());
    withdrawNotice(one.db, 'N-2025-001');
    expect(nextNoticeId(one.db, 2025)).toBe('N-2025-002');
  });

  it('numbers each year on its own', () => {
    const one = ready();
    saveNotice(one.db, notice({ id: 'N-2025-007' }));
    expect(nextNoticeId(one.db, 2026)).toBe('N-2026-001');
  });
});
