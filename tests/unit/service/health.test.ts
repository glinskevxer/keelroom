import { afterEach, describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY } from '../../../src/util/clock';
import { makeInterval } from '../../../src/util/interval';
import { makeNotice } from '../../../src/domain/notice/notice';
import { makeTug } from '../../../src/domain/tug/tug';
import { saveNotice } from '../../../src/storage/notice-store';
import { saveTug, bookTugs } from '../../../src/storage/tug-store';
import { saveBoard } from '../../../src/storage/roster-store';
import { makeBoard } from '../../../src/domain/roster/board';
import { placeOrder, cancelOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import { assignPilot } from '../../../src/service/dispatch';
import { checkDistrict, warningsOnly } from '../../../src/service/health';
import { NOW, PILOTS, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function order(at = NOW + MINUTES_PER_DAY, draught = 1000): string {
  return placeOrder(harness!.context, {
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught,
    requestedFor: at,
  }).movement.reference;
}

describe('a healthy district', () => {
  it('has nothing to say about itself', () => {
    harness = testContext();
    expect(checkDistrict(harness.context)).toEqual([]);
  });

  it('says nothing about a movement that is planned and assigned', () => {
    harness = testContext();
    const reference = order();
    confirmMovement(harness.context, { reference });
    assignPilot(harness.context, { reference });
    const findings = checkDistrict(harness.context).filter(
      (finding) => finding.subject === reference,
    );
    expect(findings.map((finding) => finding.check)).toEqual(['HEALTH-TUGS']);
  });
});

describe('what it notices', () => {
  it('a survey old enough to matter', () => {
    harness = testContext();
    const findings = checkDistrict(harness.context, { staleSurveyDays: 30 });
    expect(findings.some((finding) => finding.check === 'HEALTH-SURVEY')).toBe(true);
  });

  it('an order whose time has gone', () => {
    harness = testContext();
    const reference = order(NOW + 60);
    const later = { ...harness.context, now: (): number => NOW + 600 };
    const findings = checkDistrict(later);
    expect(
      findings.some((finding) => finding.check === 'HEALTH-LATE' && finding.subject === reference),
    ).toBe(true);
  });

  it('tugs still held for a movement that is not going', () => {
    harness = testContext();
    saveTug(harness.temp.db, makeTug({ id: 'T1', name: 'Bar Master', owner: 'HARBOUR', pull: 60 }));
    const reference = order();
    confirmMovement(harness.context, { reference });
    bookTugs(harness.temp.db, reference, [
      { tug: 'T1', movement: reference, period: makeInterval(NOW, NOW + 2 * MINUTES_PER_DAY) },
    ]);
    cancelOrder(harness.context, reference, 'ship broke down');
    expect(
      checkDistrict(harness.context).some((finding) => finding.check === 'HEALTH-TUGHELD'),
    ).toBe(true);
  });

  it('a berth double booked', () => {
    harness = testContext();
    const first = order();
    confirmMovement(harness.context, { reference: first });
    const second = placeOrder(harness.context, {
      kind: 'arrival',
      vessel: '9074705',
      agent: 'NORTH',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 600,
      requestedFor: NOW + 2 * MINUTES_PER_DAY,
    }).movement.reference;
    confirmMovement(harness.context, { reference: second });
    expect(checkDistrict(harness.context).some((finding) => finding.check === 'HEALTH-BERTH')).toBe(
      true,
    );
  });

  it('a notice about to run out', () => {
    harness = testContext();
    saveNotice(
      harness.temp.db,
      makeNotice({
        id: 'N-2025-001',
        kind: 'information',
        subject: 'LOWER-BAR',
        from: NOW - 100,
        to: NOW + 300,
        text: 'buoy 7 off station',
        issuedAt: NOW - 100,
      }),
    );
    const findings = checkDistrict(harness.context);
    expect(findings.some((finding) => finding.check === 'HEALTH-NOTICE')).toBe(true);
  });

  it('a pilot on the board who is not on the roster', () => {
    harness = testContext();
    harness.temp.db.prepare('update pilot set active = 0 where id = ?').run('P11');
    expect(checkDistrict(harness.context).some((finding) => finding.check === 'HEALTH-BOARD')).toBe(
      true,
    );
  });

  it('a pilot on the roster who is not on the board', () => {
    harness = testContext();
    saveBoard(harness.temp.db, makeBoard([PILOTS[0]!]));
    const findings = checkDistrict(harness.context).filter(
      (finding) => finding.check === 'HEALTH-BOARD',
    );
    expect(findings).toHaveLength(2);
  });

  it('a window that has closed under a confirmed movement', () => {
    harness = testContext();
    const reference = order(NOW + MINUTES_PER_DAY, 1150);
    confirmMovement(harness.context, { reference });
    saveNotice(
      harness.temp.db,
      makeNotice({
        id: 'N-2025-002',
        kind: 'draught-cap',
        subject: 'LOWER-BAR',
        from: NOW,
        to: NOW + 5 * MINUTES_PER_DAY,
        text: 'dredger working',
        value: 900,
        issuedAt: NOW,
      }),
    );
    const findings = checkDistrict(harness.context, { replan: true });
    expect(findings.some((finding) => finding.check === 'HEALTH-WINDOW')).toBe(true);
  });

  it('sorts the warnings ahead of the notes', () => {
    harness = testContext();
    const findings = checkDistrict(harness.context, { staleSurveyDays: 30 });
    const severities = findings.map((finding) => finding.severity);
    expect(severities.indexOf('warning')).toBeLessThanOrEqual(
      severities.lastIndexOf('note') === -1 ? severities.length : severities.lastIndexOf('note'),
    );
    expect(warningsOnly(findings).every((finding) => finding.severity === 'warning')).toBe(true);
  });
});
