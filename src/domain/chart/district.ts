/**
 * The district is everything the planner needs to know about the port: the
 * gauges, the reaches in seaward order, the berths, the structures overhead and
 * the standing policy numbers.
 *
 * It is assembled once and checked once. Every reference inside it is resolved
 * at that point, so nothing downstream has to deal with a berth that names a
 * reach the district does not have.
 */

import { InputError, NotFoundError } from '../../util/errors';
import type { Offset } from '../../util/clock';
import type { TideStation } from '../tide/station';
import type { Berth } from './berth';
import type { Overhead } from './overhead';
import type { Reach } from './reach';

export interface District {
  readonly code: string;
  readonly name: string;
  /** Minutes east of utc, held all year. */
  readonly offset: Offset;
  /** Reaches in seaward first order. */
  readonly reaches: readonly Reach[];
  readonly stations: readonly TideStation[];
  readonly berths: readonly Berth[];
  readonly overheads: readonly Overhead[];
}

const DISTRICT_CODE = /^[A-Z]{2,6}$/;

export function makeDistrict(input: {
  code: string;
  name: string;
  offset: Offset;
  reaches: readonly Reach[];
  stations: readonly TideStation[];
  berths: readonly Berth[];
  overheads?: readonly Overhead[];
}): District {
  if (!DISTRICT_CODE.test(input.code)) {
    throw new InputError(`district code must be two to six upper case letters, got ${input.code}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`district ${input.code} has no name`);
  }
  if (!Number.isInteger(input.offset) || Math.abs(input.offset) > 840) {
    throw new InputError(`district ${input.code} has an impossible zone offset`);
  }
  if (input.reaches.length === 0) {
    throw new InputError(`district ${input.code} has no reaches`);
  }
  if (input.stations.length === 0) {
    throw new InputError(`district ${input.code} has no tide stations`);
  }
  const overheads = input.overheads ?? [];
  requireUnique(
    input.reaches.map((reach) => reach.id),
    'reach',
  );
  requireUnique(
    input.stations.map((station) => station.id),
    'station',
  );
  requireUnique(
    input.berths.map((berth) => berth.id),
    'berth',
  );
  requireUnique(
    overheads.map((overhead) => overhead.id),
    'overhead',
  );
  const stationIds = new Set(input.stations.map((station) => station.id));
  const reachIds = new Set(input.reaches.map((reach) => reach.id));
  for (const reach of input.reaches) {
    if (!stationIds.has(reach.station)) {
      throw new InputError(`reach ${reach.id} names a station the district does not have`, {
        station: reach.station,
      });
    }
  }
  for (const berth of input.berths) {
    if (!reachIds.has(berth.reach)) {
      throw new InputError(`berth ${berth.id} names a reach the district does not have`, {
        reach: berth.reach,
      });
    }
  }
  for (const overhead of overheads) {
    if (!reachIds.has(overhead.reach)) {
      throw new InputError(`overhead ${overhead.id} names a reach the district does not have`, {
        reach: overhead.reach,
      });
    }
    if (!stationIds.has(overhead.station)) {
      throw new InputError(`overhead ${overhead.id} names a station the district does not have`, {
        station: overhead.station,
      });
    }
  }
  return {
    code: input.code,
    name: input.name.trim(),
    offset: input.offset,
    reaches: [...input.reaches],
    stations: [...input.stations],
    berths: [...input.berths],
    overheads: [...overheads],
  };
}

function requireUnique(ids: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new InputError(`the district carries ${kind} ${id} twice`);
    }
    seen.add(id);
  }
}

export function findReach(district: District, id: string): Reach | undefined {
  return district.reaches.find((reach) => reach.id === id);
}

export function requireReach(district: District, id: string): Reach {
  const reach = findReach(district, id);
  if (reach === undefined) {
    throw new NotFoundError('reach', id);
  }
  return reach;
}

export function findStation(district: District, id: string): TideStation | undefined {
  return district.stations.find((station) => station.id === id);
}

export function requireStation(district: District, id: string): TideStation {
  const station = findStation(district, id);
  if (station === undefined) {
    throw new NotFoundError('tide station', id);
  }
  return station;
}

export function findBerth(district: District, id: string): Berth | undefined {
  return district.berths.find((berth) => berth.id === id);
}

export function requireBerth(district: District, id: string): Berth {
  const berth = findBerth(district, id);
  if (berth === undefined) {
    throw new NotFoundError('berth', id);
  }
  return berth;
}

/** The station a reach is planned against, resolved. */
export function stationForReach(district: District, reach: Reach): TideStation {
  return requireStation(district, reach.station);
}

/** Every structure over a reach, in charted order along the channel. */
export function overheadsOn(district: District, reachId: string): Overhead[] {
  return district.overheads.filter((overhead) => overhead.reach === reachId);
}

/**
 * The reaches between the sea and a berth, seaward first. A berth on the second
 * reach is reached over the first two and no further.
 */
export function reachesToBerth(district: District, berth: Berth): Reach[] {
  const index = district.reaches.findIndex((reach) => reach.id === berth.reach);
  if (index < 0) {
    throw new NotFoundError('reach', berth.reach);
  }
  return district.reaches.slice(0, index + 1);
}

/** How far up the district a reach sits, counting from the sea. */
export function reachOrder(district: District, reachId: string): number {
  const index = district.reaches.findIndex((reach) => reach.id === reachId);
  if (index < 0) {
    throw new NotFoundError('reach', reachId);
  }
  return index;
}

export function describeDistrict(district: District): string {
  return (
    `${district.code} ${district.name}: ${district.reaches.length} reaches, ` +
    `${district.berths.length} berths, ${district.stations.length} stations`
  );
}
