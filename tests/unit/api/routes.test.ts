import { afterEach, describe, expect, it } from 'vitest';
import { buildRouter } from '../../../src/api/routes';
import { parseQuery, Router } from '../../../src/api/router';
import type { Response } from '../../../src/api/router';
import { placeOrder } from '../../../src/service/ordering';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function call(path: string, query: Record<string, string> = {}, method = 'GET'): Response {
  const router = buildRouter(harness!.context);
  return router.handle({ method, path, query, params: {} });
}

function order(): string {
  return placeOrder(harness!.context, {
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught: 1100,
    requestedFor: NOW + 2880,
  }).movement.reference;
}

describe('the router itself', () => {
  it('matches a path with a parameter', () => {
    const router = new Router().get('/thing/:id', (request) => ({
      status: 200,
      body: request.params.id,
    }));
    expect(router.handle({ method: 'GET', path: '/thing/42', query: {}, params: {} })).toEqual({
      status: 200,
      body: '42',
    });
  });

  it('gives 404 for a path nobody serves', () => {
    const router = new Router().get('/thing', () => ({ status: 200, body: 'x' }));
    expect(router.handle({ method: 'GET', path: '/other', query: {}, params: {} }).status).toBe(
      404,
    );
  });

  it('gives 405 when the path exists at another method', () => {
    const router = new Router().get('/thing', () => ({ status: 200, body: 'x' }));
    expect(router.handle({ method: 'POST', path: '/thing', query: {}, params: {} }).status).toBe(
      405,
    );
  });

  it('turns an error into a status', () => {
    const router = new Router().get('/boom', () => {
      throw new Error('it broke');
    });
    const response = router.handle({ method: 'GET', path: '/boom', query: {}, params: {} });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'it broke' });
  });

  it('decodes a parameter', () => {
    const router = new Router().get('/thing/:name', (request) => ({
      status: 200,
      body: request.params.name,
    }));
    expect(router.handle({ method: 'GET', path: '/thing/a%20b', query: {}, params: {} }).body).toBe(
      'a b',
    );
  });

  it('reads a query string', () => {
    expect(parseQuery('?days=3&format=json')).toEqual({ days: '3', format: 'json' });
    expect(parseQuery('')).toEqual({});
  });
});

describe('the routes', () => {
  it('index lists what it serves', () => {
    harness = testContext();
    const response = call('/');
    expect(response.status).toBe(200);
    const body = response.body as { routes: { path: string }[]; district: string };
    expect(body.district).toBe('KLR');
    expect(body.routes.some((route) => route.path === '/board')).toBe(true);
  });

  it('district gives the reaches with both depths', () => {
    harness = testContext();
    const body = call('/district').body as { reaches: { id: string; plannedDepth: number }[] };
    expect(body.reaches).toHaveLength(3);
    expect(body.reaches[1]?.plannedDepth).toBeLessThan(1290);
  });

  it('tides give the extremes', () => {
    harness = testContext();
    const body = call('/tides/NARROWS', { days: '1' }).body as { extremes: unknown[] };
    expect(body.extremes.length).toBeGreaterThan(2);
    expect(call('/tides/NOWHERE').status).toBe(404);
  });

  it('vessels list and show', () => {
    harness = testContext();
    expect(call('/vessels').body).toHaveLength(3);
    const body = call('/vessels/9074729').body as { units: number };
    expect(body.units).toBeGreaterThan(0);
    expect(call('/vessels/9123453').status).toBe(404);
  });

  it('movements list with a count', () => {
    harness = testContext();
    order();
    const body = call('/movements', { days: '5' }).body as {
      counts: { ordered: number };
      movements: unknown[];
    };
    expect(body.counts.ordered).toBe(1);
    expect(body.movements).toHaveLength(1);
  });

  it('one movement with its card', () => {
    harness = testContext();
    const reference = order();
    const body = call(`/movements/${reference}`).body as { times: unknown };
    expect(body.times).toBeNull();
    expect(call('/movements/M-2025-9999').status).toBe(404);
  });

  it('a plan for a movement', () => {
    harness = testContext();
    const reference = order();
    const body = call(`/movements/${reference}/plan`, { hours: '12' }).body as {
      windows: unknown[];
      tugs: number;
    };
    expect(body.windows.length).toBeGreaterThan(0);
    expect(body.tugs).toBeGreaterThan(0);
    expect(call('/movements/M-2025-9999/plan').status).toBe(404);
  });

  it('an agent movements and statement', () => {
    harness = testContext();
    order();
    expect(call('/agents/SEAWAY/movements').body).toHaveLength(1);
    const statement = call('/agents/SEAWAY/statement').body as { balance: number };
    expect(statement.balance).toBe(0);
  });

  it('the board in turn order', () => {
    harness = testContext();
    const body = call('/board').body as { pilot: string }[];
    expect(body.map((line) => line.pilot)).toEqual(['P02', 'P07', 'P11']);
  });

  it('refuses a query value that is not a number', () => {
    harness = testContext();
    expect(call('/movements', { days: 'many' }).status).toBe(500);
  });

  it('gives the tide either side of a window', () => {
    harness = testContext();
    const body = call('/windows', { hours: '6' }).body as { heights: number[] };
    expect(body.heights).toHaveLength(2);
  });
});

describe('the rest of the read side', () => {
  it('serves the notices in force and the standing ones', () => {
    harness = testContext();
    const body = call('/notices').body as { inForce: unknown[]; standing: unknown[] };
    expect(body.inForce).toEqual([]);
    expect(body.standing).toEqual([]);
  });

  it('serves the traffic for the day', () => {
    harness = testContext();
    const body = call('/traffic', { days: '2' }).body as { conflicts: unknown[] };
    expect(body.conflicts).toEqual([]);
  });

  it('serves the berth diary with the utilisation', () => {
    harness = testContext();
    const body = call('/berths', { days: '3' }).body as { utilisation: unknown[] };
    expect(Array.isArray(body.utilisation)).toBe(true);
  });

  it('serves the weather log and what a plan would use', () => {
    harness = testContext();
    const body = call('/weather').body as { log: unknown[]; planningWith: unknown };
    expect(body.log).toEqual([]);
    expect(body.planningWith).toBeNull();
  });

  it('serves the tug fleet and its bookings', () => {
    harness = testContext();
    const body = call('/tugs').body as { fleet: unknown[]; bookings: unknown[] };
    expect(body.fleet).toEqual([]);
    expect(body.bookings).toEqual([]);
  });

  it('serves the district return', () => {
    harness = testContext();
    const body = call('/return', { days: '7' }).body as { summary: { ordered: number } };
    expect(body.summary.ordered).toBe(0);
  });

  it('lists every route on the index', () => {
    harness = testContext();
    const body = call('/').body as { routes: { path: string }[] };
    for (const path of ['/notices', '/traffic', '/berths', '/weather', '/tugs', '/return']) {
      expect(body.routes.some((route) => route.path === path)).toBe(true);
    }
  });
});
