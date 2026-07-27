/**
 * The read side, route by route.
 *
 * Everything here is a query against the same services the command line uses,
 * so an agent reading the api and a despatcher reading the terminal cannot be
 * told different things about the same movement.
 */

import { MINUTES_PER_DAY } from '../util/clock';
import { makeInterval } from '../util/interval';
import { NotFoundError } from '../util/errors';
import { findStation } from '../domain/chart/district';
import { plannedDepth } from '../domain/chart/reach';
import { findExtremes } from '../domain/tide/extremes';
import { predictHeight } from '../domain/tide/predict';
import { pilotageUnits } from '../domain/vessel/vessel';
import { countByState } from '../report/orders';
import { loadBoard } from '../storage/roster-store';
import { allPilots } from '../storage/roster-store';
import { findVessel, allVessels } from '../storage/fleet-store';
import {
  findMovement,
  findTimes,
  movementsForAgent,
  movementsInWindow,
} from '../storage/movement-store';
import { planMovement } from '../service/planning';
import { statementFor } from '../service/collections';
import type { Context } from '../service/context';
import { Router, paginate, queryInteger, readPage } from './router';
import { standingNotices, noticesOn } from '../storage/notice-store';
import { currentNotices } from '../domain/notice/notice';
import { trafficDay } from '../service/traffic';
import { diaryForDays, utilisation } from '../service/berths';
import { returnForDays } from '../service/statistics';
import { weatherBetween } from '../storage/weather-store';
import { readingAt } from '../domain/weather/observation';
import { allTugs, bookingsInPeriod } from '../storage/tug-store';
import { order } from '../domain/roster/board';
import { VERSION } from '../version';

export function buildRouter(context: Context): Router {
  const router = new Router();
  const offset = context.district.offset;

  router.get('/', () => ({
    status: 200,
    body: {
      district: context.district.code,
      name: context.district.name,
      version: VERSION,
      routes: router.list(),
    },
  }));

  router.get('/district', () => ({
    status: 200,
    body: {
      code: context.district.code,
      name: context.district.name,
      offset,
      reaches: context.district.reaches.map((reach) => ({
        id: reach.id,
        name: reach.name,
        chartedDepth: reach.chartedDepth,
        plannedDepth: plannedDepth(reach, context.now()),
        channel: reach.channel,
      })),
      berths: context.district.berths.map((berth) => ({
        id: berth.id,
        name: berth.name,
        kind: berth.kind,
        depth: berth.depth,
      })),
    },
  }));

  router.get('/tides/:station', (request) => {
    const station = findStation(context.district, request.params.station ?? '');
    if (station === undefined) {
      throw new NotFoundError('tide station', request.params.station ?? '');
    }
    const days = queryInteger(request, 'days', 2);
    const from = context.now();
    const to = from + days * MINUTES_PER_DAY;
    return {
      status: 200,
      body: {
        station: station.id,
        now: predictHeight(station, from),
        extremes: findExtremes(station, from, to),
      },
    };
  });

  router.get('/vessels', (request) => ({
    status: 200,
    body: paginate(
      allVessels(context.db).map((vessel) => ({
        imo: vessel.imo,
        name: vessel.name,
        type: vessel.type,
        units: pilotageUnits(vessel),
      })),
      readPage(request),
    ),
  }));

  router.get('/vessels/:imo', (request) => {
    const vessel = findVessel(context.db, request.params.imo ?? '');
    if (vessel === undefined) {
      throw new NotFoundError('vessel', request.params.imo ?? '');
    }
    return { status: 200, body: { ...vessel, units: pilotageUnits(vessel) } };
  });

  router.get('/movements', (request) => {
    const days = queryInteger(request, 'days', 2);
    const from = context.now();
    const movements = movementsInWindow(context.db, from, from + days * MINUTES_PER_DAY);
    return {
      status: 200,
      body: { counts: countByState(movements), ...paginate(movements, readPage(request)) },
    };
  });

  router.get('/movements/:reference', (request) => {
    const reference = request.params.reference ?? '';
    const movement = findMovement(context.db, reference);
    if (movement === undefined) {
      throw new NotFoundError('movement', reference);
    }
    return { status: 200, body: { movement, times: findTimes(context.db, reference) ?? null } };
  });

  router.get('/movements/:reference/plan', (request) => {
    const reference = request.params.reference ?? '';
    if (findMovement(context.db, reference) === undefined) {
      throw new NotFoundError('movement', reference);
    }
    const hours = queryInteger(request, 'hours', 12);
    const result = planMovement(context, { reference, searchHours: hours });
    return {
      status: 200,
      body: {
        reference,
        windows: result.result.windows,
        passable: result.result.passable,
        findings: result.result.findings,
        tugs: result.result.restrictions.tugs,
        daylightOnly: result.result.restrictions.daylightOnly,
      },
    };
  });

  router.get('/agents/:agent/movements', (request) => {
    const agent = request.params.agent ?? '';
    return {
      status: 200,
      body: paginate(movementsForAgent(context.db, agent), readPage(request)),
    };
  });

  router.get('/agents/:agent/statement', (request) => {
    const agent = request.params.agent ?? '';
    return { status: 200, body: statementFor(context, agent) };
  });

  router.get('/board', () => {
    const board = loadBoard(context.db);
    const byId = new Map(allPilots(context.db).map((pilot) => [pilot.id, pilot]));
    return {
      status: 200,
      body: order(board).map((id, index) => ({
        position: index + 1,
        pilot: id,
        name: byId.get(id)?.name ?? 'not on the roster',
        grade: byId.get(id)?.grade ?? null,
      })),
    };
  });

  router.get('/notices', (request) => {
    const subject = request.query.subject;
    const notices =
      subject === undefined ? standingNotices(context.db) : noticesOn(context.db, subject);
    return {
      status: 200,
      body: {
        inForce: currentNotices(notices, context.now()),
        standing: notices,
      },
    };
  });

  router.get('/traffic', (request) => {
    const days = queryInteger(request, 'days', 1);
    const day = trafficDay(context, context.now(), days);
    return {
      status: 200,
      body: {
        movements: day.movements,
        occupancies: day.occupancies,
        conflicts: day.conflicts,
      },
    };
  });

  router.get('/berths', (request) => {
    const days = queryInteger(request, 'days', 7);
    const diary = diaryForDays(context, context.now(), days);
    return {
      status: 200,
      body: {
        stays: diary.stays,
        conflicts: diary.conflicts,
        open: diary.open,
        utilisation: utilisation(diary),
      },
    };
  });

  router.get('/weather', (request) => {
    const hours = queryInteger(request, 'hours', 24);
    const log = weatherBetween(context.db, context.now() - hours * 60, context.now() + hours * 60);
    return {
      status: 200,
      body: {
        log,
        planningWith: readingAt(log, context.now())?.reading ?? null,
      },
    };
  });

  router.get('/tugs', (request) => {
    const hours = queryInteger(request, 'hours', 24);
    const period = makeInterval(context.now(), context.now() + hours * 60);
    return {
      status: 200,
      body: {
        fleet: allTugs(context.db),
        bookings: bookingsInPeriod(context.db, period),
      },
    };
  });

  router.get('/return', (request) => {
    const days = queryInteger(request, 'days', 30);
    return { status: 200, body: returnForDays(context, context.now() - days * 1440, days) };
  });

  router.get('/windows', (request) => {
    const station = context.district.stations[0];
    if (station === undefined) {
      throw new NotFoundError('tide station', context.district.code);
    }
    const hours = queryInteger(request, 'hours', 24);
    const bounds = makeInterval(context.now(), context.now() + hours * 60);
    return {
      status: 200,
      body: {
        station: station.id,
        from: bounds.from,
        to: bounds.to,
        heights: [predictHeight(station, bounds.from), predictHeight(station, bounds.to)],
      },
    };
  });

  return router;
}
