/**
 * Taking data in from the people who send it.
 *
 * Four things arrive as csv: the ship particulars the agents send, the agent
 * accounts the office keeps, the harmonic constants the hydrographic office
 * publishes, and the survey results that change a reach's controlling depth.
 *
 * Every importer is all or nothing. A file with a bad row anywhere leaves the
 * database untouched and reports the line, because a half loaded chart update is
 * worse than none: the operator would have no way of knowing which reaches now
 * carry the new survey and which the old.
 */

import { InputError } from '../util/errors';
import { parseCsv, requireEnum, requireInteger } from '../util/csv';
import type { CsvRow } from '../util/csv';
import { parseInstant } from '../util/clock';
import { inTransaction } from '../storage/database';
import type { Db } from '../storage/database';
import { makeVessel } from '../domain/vessel/vessel';
import type { Vessel, VesselType } from '../domain/vessel/vessel';
import { makeAccount } from '../domain/billing/account';
import type { Account } from '../domain/billing/account';
import { isKnownConstituent } from '../domain/tide/constituent';
import { saveAccount, saveVessel } from '../storage/fleet-store';
import type { MovementKind } from '../domain/movement/movement';
import type { Context } from './context';
import { amendOrder, placeOrder } from './ordering';

export interface ImportSummary {
  readonly read: number;
  readonly written: number;
  readonly kind: string;
}

const VESSEL_TYPES: VesselType[] = [
  'bulk',
  'container',
  'tanker',
  'gas',
  'general',
  'roro',
  'passenger',
  'other',
];

function optionalInteger(row: CsvRow, column: string, fallback: number): number {
  const value = row.optional(column);
  if (value === undefined) {
    return fallback;
  }
  if (!/^-?\d+$/.test(value.trim())) {
    throw new InputError(`line ${row.line}: ${column} is not a whole number`);
  }
  return Number(value);
}

export function readVessels(text: string, source = 'vessels.csv'): Vessel[] {
  const table = parseCsv(text, { source });
  return table.rows.map((row) =>
    makeVessel({
      imo: row.get('imo'),
      name: row.get('name'),
      type: requireEnum(row, 'type', VESSEL_TYPES),
      length: requireInteger(row, 'length_cm'),
      beam: requireInteger(row, 'beam_cm'),
      summerDraught: requireInteger(row, 'summer_draught_cm'),
      airDraught: requireInteger(row, 'air_draught_cm'),
      grossTonnage: requireInteger(row, 'gross_tonnage'),
      deadweight: optionalInteger(row, 'deadweight', 0),
      ...(row.has('block_coefficient') && row.optional('block_coefficient') !== undefined
        ? { blockCoefficient: requireInteger(row, 'block_coefficient') }
        : {}),
      bowThruster: (row.optional('bow_thruster') ?? 'no').toLowerCase() === 'yes',
    }),
  );
}

export function importVessels(db: Db, text: string, source = 'vessels.csv'): ImportSummary {
  const vessels = readVessels(text, source);
  inTransaction(db, (inner) => {
    for (const vessel of vessels) {
      saveVessel(inner, vessel);
    }
  });
  return { read: vessels.length, written: vessels.length, kind: 'vessel' };
}

export function readAccounts(text: string, source = 'accounts.csv'): Account[] {
  const table = parseCsv(text, { source });
  return table.rows.map((row) =>
    makeAccount({
      agent: row.get('agent'),
      name: row.get('name'),
      termsDays: optionalInteger(row, 'terms_days', 30),
      discount: optionalInteger(row, 'discount_bps', 0),
      creditLimit: optionalInteger(row, 'credit_limit', 0),
      stopped: (row.optional('stopped') ?? 'no').toLowerCase() === 'yes',
      requiresDeposit: (row.optional('requires_deposit') ?? 'no').toLowerCase() === 'yes',
    }),
  );
}

export function importAccounts(db: Db, text: string, source = 'accounts.csv'): ImportSummary {
  const accounts = readAccounts(text, source);
  inTransaction(db, (inner) => {
    for (const account of accounts) {
      saveAccount(inner, account);
    }
  });
  return { read: accounts.length, written: accounts.length, kind: 'account' };
}

export interface HarmonicUpdate {
  readonly station: string;
  readonly constituent: string;
  readonly amplitude: number;
  readonly phase: number;
}

export function readHarmonics(text: string, source = 'harmonics.csv'): HarmonicUpdate[] {
  const table = parseCsv(text, { source });
  return table.rows.map((row) => {
    const constituent = row.get('constituent').toUpperCase();
    if (!isKnownConstituent(constituent)) {
      throw new InputError(`line ${row.line}: ${constituent} is not a constituent we carry`);
    }
    const amplitude = requireInteger(row, 'amplitude_cm');
    if (amplitude < 0) {
      throw new InputError(`line ${row.line}: a negative amplitude is not one`);
    }
    const phase = Number(row.get('phase_degrees'));
    if (!Number.isFinite(phase) || phase < 0 || phase >= 360) {
      throw new InputError(`line ${row.line}: the phase is outside a single turn`);
    }
    return { station: row.get('station'), constituent, amplitude, phase };
  });
}

/** Replace the terms of every station named in the file, and no others. */
export function importHarmonics(db: Db, text: string, source = 'harmonics.csv'): ImportSummary {
  const updates = readHarmonics(text, source);
  const stations = new Set(updates.map((update) => update.station));
  inTransaction(db, (inner) => {
    for (const station of stations) {
      const known = inner.prepare('select id from tide_station where id = ?').get(station);
      if (known === undefined) {
        throw new InputError(`the district has no tide station ${station}`);
      }
      inner.prepare('delete from tide_term where station = ?').run(station);
    }
    const insert = inner.prepare(
      `insert into tide_term (station, constituent, amplitude_cm, phase_degrees)
       values (?, ?, ?, ?)`,
    );
    for (const update of updates) {
      insert.run(update.station, update.constituent, update.amplitude, update.phase);
    }
  });
  return { read: updates.length, written: updates.length, kind: 'harmonic' };
}

export interface SurveyUpdate {
  readonly reach: string;
  readonly chartedDepth: number;
  readonly surveyedAt: number;
  readonly tolerance: number;
}

export function readSurveys(text: string, source = 'surveys.csv'): SurveyUpdate[] {
  const table = parseCsv(text, { source });
  return table.rows.map((row) => {
    const chartedDepth = requireInteger(row, 'charted_depth_cm');
    if (chartedDepth <= 0) {
      throw new InputError(`line ${row.line}: a reach with no depth is a closed reach`);
    }
    return {
      reach: row.get('reach'),
      chartedDepth,
      surveyedAt: parseInstant(row.get('surveyed_at')),
      tolerance: optionalInteger(row, 'tolerance_cm', 10),
    };
  });
}

/** Apply a survey to the reaches it names, refusing any the district lacks. */
export function importSurveys(db: Db, text: string, source = 'surveys.csv'): ImportSummary {
  const updates = readSurveys(text, source);
  const written = inTransaction(db, (inner) => {
    let count = 0;
    const update = inner.prepare(
      `update reach set charted_depth_cm = ?, surveyed_at = ?, survey_tolerance_cm = ?
       where id = ?`,
    );
    for (const survey of updates) {
      const changed = update.run(
        survey.chartedDepth,
        survey.surveyedAt,
        survey.tolerance,
        survey.reach,
      ).changes;
      if (changed === 0) {
        throw new InputError(`the district has no reach ${survey.reach}`);
      }
      count += changed;
    }
    return count;
  });
  return { read: updates.length, written, kind: 'survey' };
}

const KINDS: MovementKind[] = ['arrival', 'departure', 'shift', 'anchorage', 'swing'];

export interface OrderRow {
  readonly vessel: string;
  readonly agent: string;
  readonly kind: MovementKind;
  readonly from: string;
  readonly to: string;
  readonly draught: number;
  readonly requestedFor: string;
  readonly note?: string;
}

export function readOrders(text: string, source = 'orders.csv'): OrderRow[] {
  const table = parseCsv(text, { source });
  return table.rows.map((row) => ({
    vessel: row.get('imo'),
    agent: row.get('agent'),
    kind: requireEnum(row, 'kind', KINDS),
    from: row.get('from'),
    to: row.get('to'),
    draught: requireInteger(row, 'draught_cm'),
    requestedFor: row.get('requested_for'),
    ...(row.optional('note') === undefined ? {} : { note: row.optional('note') ?? '' }),
  }));
}

export interface OrderImport extends ImportSummary {
  readonly references: readonly string[];
}

/**
 * Take a file of orders from an agent. The desk's checks run on every row, so a
 * file with one bad order writes none of them: an agent sending a week of liner
 * calls would rather fix the file than work out which four of the seven landed.
 */
export function importOrders(context: Context, text: string, source = 'orders.csv'): OrderImport {
  const orders = readOrders(text, source);
  const references = inTransaction(context.db, () =>
    orders.map(
      (order) =>
        placeOrder(context, {
          kind: order.kind,
          vessel: order.vessel,
          agent: order.agent,
          from: order.from,
          to: order.to,
          draught: order.draught,
          requestedFor: parseInstant(order.requestedFor),
          ...(order.note === undefined ? {} : { notes: [order.note] }),
        }).movement.reference,
    ),
  );
  return { read: orders.length, written: references.length, kind: 'order', references };
}

export interface EtaRow {
  readonly reference: string;
  readonly requestedFor: string;
  readonly draught?: number;
}

export function readEtas(text: string, source = 'etas.csv'): EtaRow[] {
  const table = parseCsv(text, { source });
  return table.rows.map((row) => ({
    reference: row.get('reference'),
    requestedFor: row.get('requested_for'),
    ...(row.optional('draught_cm') === undefined
      ? {}
      : { draught: requireInteger(row, 'draught_cm') }),
  }));
}

export interface EtaImport extends ImportSummary {
  /** The movements whose planned time was dropped and want replanning. */
  readonly replan: readonly string[];
}

/**
 * Agents send a revised estimated arrival for a list of ships rather than
 * telephoning about each one. Every row goes through the same amendment the desk
 * would make by hand, which means a confirmed movement loses its planned time
 * and comes back onto the planning list rather than quietly keeping a window it
 * no longer fits.
 */
export function importEtas(context: Context, text: string, source = 'etas.csv'): EtaImport {
  const rows = readEtas(text, source);
  const replan = inTransaction(context.db, () =>
    rows.map((row) => {
      const amended = amendOrder(context, row.reference, {
        requestedFor: parseInstant(row.requestedFor),
        ...(row.draught === undefined ? {} : { draught: row.draught }),
      });
      return amended.reference;
    }),
  );
  return { read: rows.length, written: replan.length, kind: 'eta', replan };
}
