import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeInterval } from '../../../src/util/interval';
import {
  bindsOn,
  closurePeriods,
  currentNotices,
  describeNotice,
  draughtCapFor,
  expiredBy,
  forcesDaylight,
  isClosed,
  isInForce,
  makeNotice,
  makeNoticeId,
  noticesFor,
  speedCapFor,
} from '../../../src/domain/notice/notice';
import type { Notice } from '../../../src/domain/notice/notice';

const T = parseInstant('2025-05-01T00:00Z');
const DAY = 1440;

function notice(overrides: Partial<Parameters<typeof makeNotice>[0]> = {}): Notice {
  return makeNotice({
    id: 'N-2025-004',
    kind: 'draught-cap',
    subject: 'LOWER-BAR',
    from: T,
    to: T + 7 * DAY,
    text: 'dredger working the bar, draught capped',
    value: 1150,
    issuedAt: T - DAY,
    ...overrides,
  });
}

describe('building a notice', () => {
  it('keeps what it was given', () => {
    const one = notice();
    expect(one.id).toBe('N-2025-004');
    expect(one.value).toBe(1150);
    expect(one.period).toEqual({ from: T, to: T + 7 * DAY });
  });

  it('numbers them by year', () => {
    expect(makeNoticeId(2025, 4)).toBe('N-2025-004');
    expect(() => makeNoticeId(2025, 0)).toThrow(/outside the notice sequence/);
    expect(() => makeNoticeId(1999, 1)).toThrow(/not a year/);
  });

  it('refuses one that is not a notice', () => {
    expect(() => notice({ id: 'N-4' })).toThrow(/not a notice number/);
    expect(() => notice({ text: '  ' })).toThrow(/says nothing/);
    expect(() => notice({ to: T - DAY })).toThrow(/ends before it starts/);
  });

  it('refuses a cap of nothing', () => {
    expect(() => notice({ kind: 'draught-cap', value: 0 })).toThrow(/caps the draught at nothing/);
    expect(() => notice({ kind: 'speed-cap', value: 0 })).toThrow(/caps the speed at nothing/);
    expect(() => notice({ kind: 'draught-cap', value: 11.5 })).toThrow(/whole centimetres/);
  });

  it('lets an information notice carry no value', () => {
    expect(notice({ kind: 'information', value: undefined }).value).toBeUndefined();
  });
});

describe('when a notice binds', () => {
  const notices = [
    notice(),
    notice({
      id: 'N-2025-005',
      kind: 'closure',
      subject: 'UPPER',
      from: T + DAY,
      to: T + 2 * DAY,
      value: undefined,
    }),
    notice({ id: 'N-2025-006', kind: 'daylight-only', subject: 'LOWER-BAR', value: undefined }),
    notice({
      id: 'N-2025-007',
      kind: 'draught-cap',
      subject: 'LOWER-BAR',
      value: 1100,
      from: T + 2 * DAY,
      to: T + 3 * DAY,
    }),
  ];

  it('is in force inside its period and not outside it', () => {
    expect(isInForce(notices[0]!, T + DAY)).toBe(true);
    expect(isInForce(notices[0]!, T - DAY)).toBe(false);
    expect(isInForce(notices[0]!, T + 8 * DAY)).toBe(false);
  });

  it('binds on its own subject and no other', () => {
    const period = makeInterval(T, T + DAY);
    expect(bindsOn(notices[0]!, 'LOWER-BAR', period)).toBe(true);
    expect(bindsOn(notices[0]!, 'UPPER', period)).toBe(false);
  });

  it('lists what binds on a subject in issue order', () => {
    const found = noticesFor(notices, 'LOWER-BAR', makeInterval(T, T + 3 * DAY));
    expect(found.map((each) => each.id)).toEqual(['N-2025-004', 'N-2025-006', 'N-2025-007']);
  });

  it('takes the tightest draught cap of the ones in force', () => {
    expect(draughtCapFor(notices, 'LOWER-BAR', makeInterval(T, T + 3 * DAY))).toBe(1100);
    expect(draughtCapFor(notices, 'LOWER-BAR', makeInterval(T, T + DAY))).toBe(1150);
    expect(draughtCapFor(notices, 'UPPER', makeInterval(T, T + DAY))).toBeUndefined();
  });

  it('takes the tightest speed cap', () => {
    const capped = [
      ...notices,
      notice({ id: 'N-2025-008', kind: 'speed-cap', subject: 'LOWER-BAR', value: 60 }),
      notice({ id: 'N-2025-009', kind: 'speed-cap', subject: 'LOWER-BAR', value: 80 }),
    ];
    expect(speedCapFor(capped, 'LOWER-BAR', makeInterval(T, T + DAY))).toBe(60);
    expect(speedCapFor(notices, 'LOWER-BAR', makeInterval(T, T + DAY))).toBeUndefined();
  });

  it('says when a reach is closed and when daylight is forced', () => {
    expect(isClosed(notices, 'UPPER', makeInterval(T + DAY, T + 2 * DAY))).toBe(true);
    expect(isClosed(notices, 'UPPER', makeInterval(T + 5 * DAY, T + 6 * DAY))).toBe(false);
    expect(forcesDaylight(notices, 'LOWER-BAR', makeInterval(T, T + DAY))).toBe(true);
    expect(forcesDaylight(notices, 'UPPER', makeInterval(T, T + DAY))).toBe(false);
  });

  it('gives the closure periods for the sweep to subtract', () => {
    expect(closurePeriods(notices, 'UPPER')).toEqual([{ from: T + DAY, to: T + 2 * DAY }]);
    expect(closurePeriods(notices, 'LOWER-BAR')).toEqual([]);
  });
});

describe('reading the board of notices', () => {
  const notices = [
    notice(),
    notice({ id: 'N-2025-001', subject: 'UPPER', from: T - 10 * DAY, to: T - 5 * DAY }),
  ];

  it('lists what is in force now', () => {
    expect(currentNotices(notices, T + DAY).map((each) => each.id)).toEqual(['N-2025-004']);
  });

  it('lists what has run out', () => {
    expect(expiredBy(notices, T).map((each) => each.id)).toEqual(['N-2025-001']);
    expect(expiredBy(notices, T - 20 * DAY)).toEqual([]);
  });

  it('describes one in a line', () => {
    expect(describeNotice(notice())).toBe(
      'N-2025-004 draught-cap (1150) on LOWER-BAR: dredger working the bar, draught capped',
    );
  });
});
