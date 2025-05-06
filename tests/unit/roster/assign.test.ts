import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { makePilot } from '../../../src/domain/roster/pilot';
import type { Pilot } from '../../../src/domain/roster/pilot';
import { entryFor, makeBoard, order } from '../../../src/domain/roster/board';
import { makeDutyEntry } from '../../../src/domain/roster/duty';
import {
  assign,
  passesByReason,
  reasonToPass,
  whoCouldTake,
} from '../../../src/domain/roster/assign';
import type { AssignmentRequest } from '../../../src/domain/roster/assign';

const T = parseInstant('2025-05-01T00:00Z');
const h = (hours: number): number => T + hours * 60;

const SHIP = makeVessel({
  imo: '9074729',
  name: 'atlantic crown',
  type: 'bulk',
  length: 12000,
  beam: 1800,
  summerDraught: 800,
  airDraught: 3600,
  grossTonnage: 12000,
});

function pilot(
  id: string,
  seniority: number,
  overrides: Partial<Parameters<typeof makePilot>[0]> = {},
): Pilot {
  return makePilot({
    id,
    name: `Pilot ${id}`,
    grade: 'unlimited',
    seniority,
    endorsements: ['NIGHT'],
    ...overrides,
  });
}

const PILOTS = [pilot('P02', 1), pilot('P11', 2), pilot('P07', 3)];

function request(overrides: Partial<AssignmentRequest> = {}): AssignmentRequest {
  return {
    board: makeBoard(PILOTS),
    pilots: PILOTS,
    duty: [],
    demand: { vessel: SHIP, draught: 800, night: false },
    job: { from: h(10), to: h(14) },
    ...overrides,
  };
}

describe('walking the board', () => {
  it('gives the ship to the pilot at the top', () => {
    const result = assign(request());
    expect(result.pilot?.id).toBe('P02');
    expect(result.passes).toEqual([]);
  });

  it('sends the pilot who took her to the bottom', () => {
    const result = assign(request());
    expect(order(result.board)).toEqual(['P11', 'P07', 'P02']);
    expect(entryFor(result.board, 'P02').jobs).toBe(1);
  });

  it('passes over a pilot on leave and records why', () => {
    const result = assign(request({ leave: { P02: [{ from: h(0), to: h(24) }] } }));
    expect(result.pilot?.id).toBe('P11');
    expect(result.passes).toEqual([{ pilot: 'P02', reason: 'leave', rule: 'ASG-LEAVE-04' }]);
    expect(entryFor(result.board, 'P02').passes).toBe(1);
  });

  it('passes over a pilot outside the licence', () => {
    const pilots = [pilot('P02', 1, { grade: 'apprentice' }), pilot('P11', 2)];
    const result = assign(request({ pilots, board: makeBoard(pilots) }));
    expect(result.pilot?.id).toBe('P11');
    expect(result.passes[0]?.reason).toBe('licence');
  });

  it('passes over a pilot who is inside the rest period', () => {
    const duty = [makeDutyEntry('P02', 'M-1', h(0), h(6))];
    const result = assign(request({ duty }));
    expect(result.pilot?.id).toBe('P11');
    expect(result.passes[0]?.reason).toBe('rest');
  });

  it('keeps the pass on the board for a pilot walked over', () => {
    const result = assign(request({ leave: { P02: [{ from: h(0), to: h(24) }] } }));
    expect(order(result.board)).toEqual(['P02', 'P07', 'P11']);
  });

  it('gives nothing back when nobody can take her', () => {
    const result = assign(
      request({
        leave: {
          P02: [{ from: h(0), to: h(24) }],
          P11: [{ from: h(0), to: h(24) }],
          P07: [{ from: h(0), to: h(24) }],
        },
      }),
    );
    expect(result.pilot).toBeUndefined();
    expect(result.findings.some((finding) => finding.rule === 'ASG-EMPTY-05')).toBe(true);
    expect(result.passes).toHaveLength(3);
  });

  it('notes a board entry the roster does not know', () => {
    const result = assign(request({ pilots: [pilot('P11', 2), pilot('P07', 3)] }));
    expect(result.passes[0]).toEqual({ pilot: 'P02', reason: 'unknown', rule: 'ASG-NONE-01' });
    expect(result.pilot?.id).toBe('P11');
  });
});

describe('asking without committing', () => {
  it('lists everybody who could take her, in board order', () => {
    const duty = [makeDutyEntry('P11', 'M-1', h(8), h(12))];
    expect(whoCouldTake(request({ duty })).map((one) => one.id)).toEqual(['P02', 'P07']);
  });

  it('says why one pilot cannot', () => {
    const duty = [makeDutyEntry('P02', 'M-1', h(0), h(6))];
    expect(reasonToPass(request({ duty }), PILOTS[0]!)).toBe('rest');
    expect(reasonToPass(request(), PILOTS[0]!)).toBeUndefined();
  });

  it('puts leave ahead of the licence when both apply', () => {
    const grounded = pilot('P02', 1, { grade: 'apprentice' });
    const current = request({ leave: { P02: [{ from: h(0), to: h(24) }] } });
    expect(reasonToPass(current, grounded)).toBe('leave');
  });

  it('groups the passes by reason', () => {
    const result = assign(
      request({
        duty: [makeDutyEntry('P02', 'M-1', h(0), h(6))],
        leave: { P11: [{ from: h(0), to: h(24) }] },
      }),
    );
    const grouped = passesByReason(result.passes);
    expect(grouped.rest).toEqual(['P02']);
    expect(grouped.leave).toEqual(['P11']);
    expect(grouped.licence).toEqual([]);
  });
});
