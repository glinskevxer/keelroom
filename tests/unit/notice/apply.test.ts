import { afterEach, describe, expect, it } from 'vitest';
import { makeInterval, totalMinutes } from '../../../src/util/interval';
import { makeNotice } from '../../../src/domain/notice/notice';
import type { Notice } from '../../../src/domain/notice/notice';
import { anyCap, cappedSpeed, noticeEffects } from '../../../src/domain/notice/apply';
import { buildPassage } from '../../../src/domain/chart/passage';
import { saveNotice } from '../../../src/storage/notice-store';
import { placeOrder } from '../../../src/service/ordering';
import {
  confirmMovement,
  deepestDraughtOffered,
  planMovement,
} from '../../../src/service/planning';
import { REACHES } from '../../support/district';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

const DAY = 1440;
const PERIOD = makeInterval(NOW, NOW + 5 * DAY);

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function notice(overrides: Partial<Parameters<typeof makeNotice>[0]> = {}): Notice {
  return makeNotice({
    id: 'N-2025-001',
    kind: 'draught-cap',
    subject: 'LOWER-BAR',
    from: NOW,
    to: NOW + 5 * DAY,
    text: 'dredger working the bar',
    value: 1000,
    issuedAt: NOW - DAY,
    ...overrides,
  });
}

const PASSAGE = buildPassage(REACHES, 'inbound', { speed: 80, startDelay: 20, endDelay: 30 });

function effectsFor(notices: readonly Notice[], draught = 1100): ReturnType<typeof noticeEffects> {
  return noticeEffects({
    notices,
    passage: PASSAGE,
    period: PERIOD,
    draught,
    district: 'KLR',
  });
}

describe('what the notices do', () => {
  it('do nothing when there are none', () => {
    const effects = effectsFor([]);
    expect(anyCap(effects)).toBe(false);
    expect(effects.findings).toEqual([]);
  });

  it('close a reach and block the movement', () => {
    const effects = effectsFor([notice({ kind: 'closure', value: undefined })]);
    expect(effects.closed).toEqual(['LOWER-BAR']);
    expect(effects.findings.map((finding) => finding.rule)).toContain('NOT-CLOSED-01');
  });

  it('refuse a ship deeper than a draught cap and pass one inside it', () => {
    expect(effectsFor([notice()], 1100).findings.map((finding) => finding.rule)).toContain(
      'NOT-DEEP-02',
    );
    expect(effectsFor([notice()], 900).findings.map((finding) => finding.rule)).toContain(
      'NOT-CAP-03',
    );
  });

  it('take the tightest cap across the passage', () => {
    const effects = effectsFor([
      notice(),
      notice({ id: 'N-2025-002', subject: 'UPPER', value: 900 }),
    ]);
    expect(effects.draughtCap).toBe(900);
  });

  it('hold the movement to daylight', () => {
    const effects = effectsFor([notice({ kind: 'daylight-only', value: undefined })]);
    expect(effects.daylightOnly).toBe(true);
  });

  it('cap the speed through one reach only', () => {
    const effects = effectsFor([notice({ kind: 'speed-cap', value: 40 })]);
    expect(effects.speedCaps).toEqual({ 'LOWER-BAR': 40 });
    expect(cappedSpeed(effects, 'LOWER-BAR', 80)).toBe(40);
    expect(cappedSpeed(effects, 'UPPER', 80)).toBe(80);
  });

  it('take a district notice as binding on the whole passage', () => {
    const effects = effectsFor([
      notice({ kind: 'daylight-only', subject: 'KLR', value: undefined }),
    ]);
    expect(effects.daylightOnly).toBe(true);
  });

  it('carry information and overtaking notices as findings', () => {
    const effects = effectsFor([
      notice({ kind: 'information', value: undefined, text: 'buoy 7 off station' }),
      notice({ id: 'N-2025-002', kind: 'no-overtaking', value: undefined }),
    ]);
    const rules = effects.findings.map((finding) => finding.rule);
    expect(rules).toContain('NOT-INFO-06');
    expect(rules).toContain('NOT-PASS-07');
  });
});

describe('planning under a notice', () => {
  function ordered(draught: number): string {
    return placeOrder(harness!.context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught,
      requestedFor: NOW + 2880,
    }).movement.reference;
  }

  it('leaves a clean plan alone', () => {
    harness = testContext();
    const plan = planMovement(harness.context, { reference: ordered(1000) });
    expect(plan.result.passable).toBe(true);
    expect(anyCap(plan.notices)).toBe(false);
  });

  it('takes every window away when a reach on the passage is closed', () => {
    harness = testContext();
    const reference = ordered(1000);
    saveNotice(harness.temp.db, notice({ kind: 'closure', value: undefined }));
    const plan = planMovement(harness.context, { reference });
    expect(plan.result.windows).toEqual([]);
    expect(plan.result.passable).toBe(false);
    expect(() => confirmMovement(harness!.context, { reference })).toThrow(/no window/);
  });

  it('refuses a ship deeper than the cap and offers the cap as the draught', () => {
    harness = testContext();
    const reference = ordered(1100);
    saveNotice(harness.temp.db, notice());
    const plan = planMovement(harness.context, { reference });
    expect(plan.result.passable).toBe(false);
    expect(deepestDraughtOffered(plan)).toBe(1000);
  });

  it('slows the passage where a speed cap is in force', () => {
    harness = testContext();
    const reference = ordered(1000);
    const before = planMovement(harness.context, { reference }).passage.minutes;
    saveNotice(harness.temp.db, notice({ kind: 'speed-cap', value: 30 }));
    const after = planMovement(harness.context, { reference });
    expect(after.passage.minutes).toBeGreaterThan(before);
    expect(after.notices.speedCaps).toEqual({ 'LOWER-BAR': 30 });
  });

  it('and a slower passage is a different set of windows', () => {
    harness = testContext();
    const reference = ordered(1150);
    const before = planMovement(harness.context, { reference }).result.windows;
    saveNotice(harness.temp.db, notice({ kind: 'speed-cap', value: 30 }));
    const after = planMovement(harness.context, { reference }).result.windows;
    expect(totalMinutes(after)).not.toBe(totalMinutes(before));
  });

  it('holds a small ship to daylight when a notice says so', () => {
    harness = testContext();
    const reference = placeOrder(harness.context, {
      kind: 'arrival',
      vessel: '9074705',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 600,
      requestedFor: NOW + 2880,
    }).movement.reference;
    const before = planMovement(harness.context, { reference });
    expect(before.result.restrictions.daylightOnly).toBe(false);
    saveNotice(harness.temp.db, notice({ kind: 'daylight-only', value: undefined }));
    const after = planMovement(harness.context, { reference });
    expect(after.result.restrictions.daylightOnly).toBe(true);
    expect(totalMinutes(after.result.windows)).toBeLessThan(totalMinutes(before.result.windows));
  });

  it('ignores a notice that has been withdrawn', () => {
    harness = testContext();
    const reference = ordered(1000);
    saveNotice(harness.temp.db, notice({ kind: 'closure', value: undefined }));
    harness.temp.db.prepare('update notice set withdrawn = 1').run();
    expect(planMovement(harness.context, { reference }).result.passable).toBe(true);
  });
});
