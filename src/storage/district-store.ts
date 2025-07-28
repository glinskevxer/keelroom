/**
 * Reading and writing the district.
 *
 * The district is one object in the domain and seven tables here, and it is
 * loaded whole because every part of the planner needs all of it. Saving is a
 * replace rather than a merge: the district as given becomes the district in the
 * file, and anything that was there and is not given any more is deleted. That
 * is what the operator means by loading a chart update.
 */

import { NotFoundError } from '../util/errors';
import type { Db } from './database';
import { inTransaction } from './database';
import type { District } from '../domain/chart/district';
import { makeDistrict } from '../domain/chart/district';
import type { Position } from '../domain/window/daylight';
import { makePosition } from '../domain/window/daylight';
import { makeReach } from '../domain/chart/reach';
import { makeBerth } from '../domain/chart/berth';
import { makeOverhead } from '../domain/chart/overhead';
import type { ChannelType } from '../domain/chart/reach';
import type { BerthKind } from '../domain/chart/berth';
import type { OverheadKind } from '../domain/chart/overhead';
import { makeStation } from '../domain/tide/station';

export interface StoredDistrict {
  readonly district: District;
  readonly position: Position;
}

interface DistrictRow {
  code: string;
  name: string;
  utc_offset: number;
  latitude: number;
  longitude: number;
}

interface StationRow {
  id: string;
  name: string;
  mean_level_cm: number;
}

interface TermRow {
  station: string;
  constituent: string;
  amplitude_cm: number;
  phase_degrees: number;
}

interface ReachRow {
  id: string;
  name: string;
  seaward_order: number;
  charted_depth_cm: number;
  length_m: number;
  width_m: number;
  channel: ChannelType;
  station: string;
  surveyed_at: number;
  shoaling_cm_year: number;
  survey_tolerance_cm: number;
  speed_limit_tenths: number;
}

interface BerthRow {
  id: string;
  name: string;
  kind: BerthKind;
  reach: string;
  depth_cm: number;
  max_length_cm: number;
  resting_clearance_cm: number;
  terminal: string;
}

interface OverheadRow {
  id: string;
  name: string;
  kind: OverheadKind;
  reach: string;
  clearance_cm: number;
  station: string;
  air_gap_cm: number;
}

export function saveDistrict(db: Db, stored: StoredDistrict): void {
  const { district, position } = stored;
  inTransaction(db, (inner) => {
    inner.prepare('delete from overhead').run();
    inner.prepare('delete from berth').run();
    inner.prepare('delete from reach').run();
    inner.prepare('delete from tide_term').run();
    inner.prepare('delete from tide_station').run();
    inner.prepare('delete from district where code = ?').run(district.code);
    inner
      .prepare(
        `insert into district (code, name, utc_offset, latitude, longitude)
         values (?, ?, ?, ?, ?)`,
      )
      .run(district.code, district.name, district.offset, position.latitude, position.longitude);
    const station = inner.prepare(
      'insert into tide_station (id, name, mean_level_cm, district) values (?, ?, ?, ?)',
    );
    const term = inner.prepare(
      `insert into tide_term (station, constituent, amplitude_cm, phase_degrees)
       values (?, ?, ?, ?)`,
    );
    for (const one of district.stations) {
      station.run(one.id, one.name, one.meanLevel, district.code);
      for (const carried of one.terms) {
        term.run(one.id, carried.name, carried.amplitude, carried.phase);
      }
    }
    const reach = inner.prepare(
      `insert into reach (id, name, district, seaward_order, charted_depth_cm, length_m, width_m,
        channel, station, surveyed_at, shoaling_cm_year, survey_tolerance_cm, speed_limit_tenths)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    district.reaches.forEach((one, index) => {
      reach.run(
        one.id,
        one.name,
        district.code,
        index,
        one.chartedDepth,
        one.length,
        one.width,
        one.channel,
        one.station,
        one.surveyed,
        one.shoalingRate,
        one.surveyTolerance,
        one.speedLimit,
      );
    });
    const berth = inner.prepare(
      `insert into berth (id, name, kind, reach, depth_cm, max_length_cm, resting_clearance_cm, terminal)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const one of district.berths) {
      berth.run(
        one.id,
        one.name,
        one.kind,
        one.reach,
        one.depth,
        one.maxLength,
        one.restingClearance,
        one.terminal,
      );
    }
    const overhead = inner.prepare(
      `insert into overhead (id, name, kind, reach, clearance_cm, station, air_gap_cm)
       values (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const one of district.overheads) {
      overhead.run(one.id, one.name, one.kind, one.reach, one.clearance, one.station, one.airGap);
    }
  });
}

export function loadDistrict(db: Db, code: string): StoredDistrict {
  const row = db.prepare('select * from district where code = ?').get(code) as
    | DistrictRow
    | undefined;
  if (row === undefined) {
    throw new NotFoundError('district', code);
  }
  const stationRows = db
    .prepare('select * from tide_station where district = ? order by id')
    .all(code) as StationRow[];
  const termRows = db
    .prepare('select * from tide_term order by station, constituent')
    .all() as TermRow[];
  const stations = stationRows.map((station) =>
    makeStation({
      id: station.id,
      name: station.name,
      meanLevel: station.mean_level_cm,
      terms: termRows
        .filter((term) => term.station === station.id)
        .map((term) => ({
          name: term.constituent,
          amplitude: term.amplitude_cm,
          phase: term.phase_degrees,
        })),
    }),
  );
  const reaches = (
    db
      .prepare('select * from reach where district = ? order by seaward_order')
      .all(code) as ReachRow[]
  ).map((reach) =>
    makeReach({
      id: reach.id,
      name: reach.name,
      chartedDepth: reach.charted_depth_cm,
      length: reach.length_m,
      width: reach.width_m,
      channel: reach.channel,
      station: reach.station,
      surveyed: reach.surveyed_at,
      shoalingRate: reach.shoaling_cm_year,
      surveyTolerance: reach.survey_tolerance_cm,
      speedLimit: reach.speed_limit_tenths,
    }),
  );
  const berths = (db.prepare('select * from berth order by id').all() as BerthRow[]).map((berth) =>
    makeBerth({
      id: berth.id,
      name: berth.name,
      kind: berth.kind,
      reach: berth.reach,
      depth: berth.depth_cm,
      maxLength: berth.max_length_cm,
      restingClearance: berth.resting_clearance_cm,
      terminal: berth.terminal,
    }),
  );
  const overheads = (db.prepare('select * from overhead order by id').all() as OverheadRow[]).map(
    (overhead) =>
      makeOverhead({
        id: overhead.id,
        name: overhead.name,
        kind: overhead.kind,
        reach: overhead.reach,
        clearance: overhead.clearance_cm,
        station: overhead.station,
        airGap: overhead.air_gap_cm,
      }),
  );
  return {
    district: makeDistrict({
      code: row.code,
      name: row.name,
      offset: row.utc_offset,
      reaches,
      stations,
      berths,
      overheads,
    }),
    position: makePosition(row.latitude, row.longitude),
  };
}

export function districtCodes(db: Db): string[] {
  const rows = db.prepare('select code from district order by code').all() as { code: string }[];
  return rows.map((row) => row.code);
}

export function hasDistrict(db: Db, code: string): boolean {
  return districtCodes(db).includes(code);
}
