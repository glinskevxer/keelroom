/**
 * The public surface.
 *
 * Anything exported here is something an embedder can rely on, so this checks
 * the surface is what the README says it is: every domain has a way in, nothing
 * internal leaks, and the pieces that are meant to work together still do when
 * they are reached through the index rather than through their own files.
 */

import { describe, expect, it } from 'vitest';
import * as keelroom from '../../src/index';

describe('what is exported', () => {
  it('names itself and its version', () => {
    expect(keelroom.NAME).toBe('keelroom');
    expect(keelroom.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('gives every domain a way in', () => {
    for (const name of [
      'makeStation',
      'makeReach',
      'makeVessel',
      'makePilot',
      'makeMovement',
      'makeBook',
      'makeInvoice',
      'makeNotice',
      'makeTug',
      'makeObservation',
      'makeGround',
      'makeDeposit',
      'makeContact',
      'makeSecondary',
      'makeDeclaration',
    ]) {
      expect(typeof (keelroom as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('gives the services and the storage a way in', () => {
    for (const name of [
      'openDatabase',
      'migrate',
      'createDistrict',
      'openContext',
      'placeOrder',
      'planMovement',
      'assignPilot',
      'priceMovement',
      'takePayment',
      'checkDistrict',
      'buildServer',
    ]) {
      expect(typeof (keelroom as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('gives the reports a way in', () => {
    for (const name of ['renderOrders', 'renderTideTable', 'renderPlan', 'renderBulletin']) {
      expect(typeof (keelroom as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('exports the exit codes as numbers', () => {
    expect(keelroom.EXIT_CLEAN).toBe(0);
    expect(keelroom.EXIT_FINDINGS).toBe(1);
    expect(keelroom.EXIT_USAGE).toBe(2);
    expect(keelroom.EXIT_INTERNAL).toBe(3);
  });

  it('keeps the internals out', () => {
    const names = Object.keys(keelroom);
    expect(names).not.toContain('prepareAt');
    expect(names).not.toContain('bisectRate');
    expect(names).not.toContain('withDistrict');
  });
});

describe('the pieces work together through the index', () => {
  it('predicts a tide and finds a window from exported pieces alone', () => {
    const station = keelroom.makeStation({
      id: 'NARROWS',
      name: 'The Narrows',
      meanLevel: 210,
      terms: [
        { name: 'M2', amplitude: 168, phase: 231.4 },
        { name: 'S2', amplitude: 31, phase: 258.9 },
      ],
    });
    const start = keelroom.parseInstant('2025-04-01T00:00Z');
    const height = keelroom.predictHeight(station, start);
    expect(Number.isInteger(height)).toBe(true);
    const windows = keelroom.intervalsAtOrAbove(
      station,
      keelroom.makeInterval(start, start + 1440),
      250,
    );
    expect(keelroom.totalMinutes(windows)).toBeGreaterThan(0);
    expect(keelroom.findExtremes(station, start, start + 1440).length).toBeGreaterThan(2);
  });

  it('measures a ship and prices her band', () => {
    const vessel = keelroom.makeVessel({
      imo: '9074729',
      name: 'atlantic crown',
      type: 'bulk',
      length: 22500,
      beam: 3220,
      summerDraught: 1180,
      airDraught: 4200,
      grossTonnage: 43000,
    });
    expect(keelroom.pilotageUnits(vessel)).toBeGreaterThan(0);
    expect(keelroom.sizeClass(vessel)).toBe('very-large');
    expect(keelroom.formatMoney(keelroom.parseMoney('1234.50'))).toBe('1234.50');
  });
});
