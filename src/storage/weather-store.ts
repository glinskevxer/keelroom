/**
 * Reading and writing the weather log.
 */

import type { Minute } from '../util/clock';
import type { Db } from './database';
import type { Observation, WeatherSource } from '../domain/weather/observation';
import { makeObservation } from '../domain/weather/observation';

interface WeatherRow {
  at: number;
  source: WeatherSource;
  wind_kn: number;
  direction: number;
  visibility: number;
  swell_cm: number;
  density: number;
}

function toObservation(row: WeatherRow): Observation {
  return makeObservation({
    at: row.at,
    source: row.source,
    wind: row.wind_kn,
    direction: row.direction,
    visibility: row.visibility,
    swell: row.swell_cm,
    density: row.density,
  });
}

export function saveObservation(db: Db, observation: Observation): void {
  db.prepare(
    `insert into weather (at, source, wind_kn, direction, visibility, swell_cm, density)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(at, source) do update set
       wind_kn = excluded.wind_kn,
       direction = excluded.direction,
       visibility = excluded.visibility,
       swell_cm = excluded.swell_cm,
       density = excluded.density`,
  ).run(
    observation.at,
    observation.source,
    observation.wind,
    observation.direction,
    observation.visibility,
    observation.swell,
    observation.density,
  );
}

export function weatherBetween(db: Db, from: Minute, to: Minute): Observation[] {
  const rows = db
    .prepare('select * from weather where at between ? and ? order by at, source')
    .all(from, to) as WeatherRow[];
  return rows.map(toObservation);
}

export function latestObservation(db: Db, at: Minute): Observation | undefined {
  const row = db
    .prepare(`select * from weather where source = 'observed' and at <= ? order by at desc limit 1`)
    .get(at) as WeatherRow | undefined;
  return row === undefined ? undefined : toObservation(row);
}

/** Everything that could be used to plan a movement around a time. */
export function weatherAround(db: Db, at: Minute, window = 720): Observation[] {
  return weatherBetween(db, at - window, at + window);
}

export function forgetBefore(db: Db, at: Minute): number {
  return db.prepare('delete from weather where at < ?').run(at).changes;
}
