/**
 * Building a district file from nothing.
 *
 * Until now a district could only be created by the tests, which is the sort of
 * gap that goes unnoticed for a year because everybody who works on it already
 * has a file. The description is json: the district and its position, the tide
 * stations with their harmonic constants, the reaches seaward first, the berths
 * and anything overhead. It is validated as a whole before a row is written, so
 * a description with a berth on a reach that is not in the file fails before the
 * district exists rather than half way through.
 */

import { z } from 'zod';
import { InputError } from '../util/errors';
import { parseInstant } from '../util/clock';
import type { Db } from '../storage/database';
import { migrate } from '../storage/migrate';
import { makeStation } from '../domain/tide/station';
import { makeReach } from '../domain/chart/reach';
import { makeBerth } from '../domain/chart/berth';
import { makeOverhead } from '../domain/chart/overhead';
import { makeDistrict } from '../domain/chart/district';
import { makePosition } from '../domain/window/daylight';
import { saveDistrict } from '../storage/district-store';

const whole = z.number().int();

const descriptionSchema = z
  .object({
    code: z.string().regex(/^[A-Z]{2,6}$/),
    name: z.string().min(1),
    utcOffset: whole.min(-840).max(840),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    stations: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().min(1),
            meanLevel: whole.nonnegative(),
            terms: z
              .array(
                z
                  .object({
                    name: z.string(),
                    amplitude: whole.nonnegative(),
                    phase: z.number().min(0).max(359.99),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
    reaches: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().min(1),
            chartedDepth: whole.positive(),
            length: z.number().positive(),
            width: z.number().positive(),
            channel: z.enum(['open', 'restricted', 'canal']),
            station: z.string(),
            surveyed: z.string(),
            shoalingRate: z.number().nonnegative().optional(),
            surveyTolerance: whole.nonnegative().optional(),
            speedLimit: whole.positive(),
          })
          .strict(),
      )
      .min(1),
    berths: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().min(1),
            kind: z.enum(['quay', 'anchorage', 'buoys', 'sea']),
            reach: z.string(),
            depth: whole.positive(),
            maxLength: whole.positive(),
            restingClearance: whole.nonnegative().optional(),
            terminal: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
    overheads: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().min(1),
            kind: z.enum(['bridge', 'cable', 'pipeline']),
            reach: z.string(),
            clearance: whole.positive(),
            station: z.string(),
            airGap: whole.nonnegative().optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type DistrictDescription = z.infer<typeof descriptionSchema>;

export function parseDescription(input: unknown): DistrictDescription {
  const result = descriptionSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new InputError(
      `the district description is not valid: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    );
  }
  return result.data;
}

export interface SetupResult {
  readonly code: string;
  readonly reaches: number;
  readonly berths: number;
  readonly stations: number;
  readonly overheads: number;
}

/** Migrate the file if it needs it and write the district into it. */
export function createDistrict(db: Db, input: unknown): SetupResult {
  const description = parseDescription(input);
  migrate(db);
  const district = makeDistrict({
    code: description.code,
    name: description.name,
    offset: description.utcOffset,
    stations: description.stations.map((station) =>
      makeStation({
        id: station.id,
        name: station.name,
        meanLevel: station.meanLevel,
        terms: station.terms,
      }),
    ),
    reaches: description.reaches.map((reach) =>
      makeReach({
        id: reach.id,
        name: reach.name,
        chartedDepth: reach.chartedDepth,
        length: reach.length,
        width: reach.width,
        channel: reach.channel,
        station: reach.station,
        surveyed: parseInstant(reach.surveyed),
        ...(reach.shoalingRate === undefined ? {} : { shoalingRate: reach.shoalingRate }),
        ...(reach.surveyTolerance === undefined ? {} : { surveyTolerance: reach.surveyTolerance }),
        speedLimit: reach.speedLimit,
      }),
    ),
    berths: description.berths.map((berth) =>
      makeBerth({
        id: berth.id,
        name: berth.name,
        kind: berth.kind,
        reach: berth.reach,
        depth: berth.depth,
        maxLength: berth.maxLength,
        ...(berth.restingClearance === undefined
          ? {}
          : { restingClearance: berth.restingClearance }),
        ...(berth.terminal === undefined ? {} : { terminal: berth.terminal }),
      }),
    ),
    overheads: description.overheads.map((overhead) =>
      makeOverhead({
        id: overhead.id,
        name: overhead.name,
        kind: overhead.kind,
        reach: overhead.reach,
        clearance: overhead.clearance,
        station: overhead.station,
        ...(overhead.airGap === undefined ? {} : { airGap: overhead.airGap }),
      }),
    ),
  });
  saveDistrict(db, {
    district,
    position: makePosition(description.latitude, description.longitude),
  });
  return {
    code: district.code,
    reaches: district.reaches.length,
    berths: district.berths.length,
    stations: district.stations.length,
    overheads: district.overheads.length,
  };
}
