import { afterEach, describe, expect, it } from 'vitest';
import { serve } from '../../../src/api/server';
import type { RunningServer } from '../../../src/api/server';
import { placeOrder } from '../../../src/service/ordering';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;
let running: RunningServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
  harness?.close();
  harness = undefined;
});

async function start(log?: (line: string) => void): Promise<string> {
  harness = testContext();
  running = await serve(harness.context, { port: 0, ...(log === undefined ? {} : { log }) });
  return `http://127.0.0.1:${running.port}`;
}

describe('the server', () => {
  it('serves the index as json', async () => {
    const base = await start();
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { district: string };
    expect(body.district).toBe('KLR');
  });

  it('tells caches not to keep anything', async () => {
    const base = await start();
    const response = await fetch(`${base}/district`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('sets a content length that matches the body', async () => {
    const base = await start();
    const response = await fetch(`${base}/board`);
    const text = await response.text();
    expect(Number(response.headers.get('content-length'))).toBe(Buffer.byteLength(text));
  });

  it('serves a movement and its plan', async () => {
    const base = await start();
    const reference = placeOrder(harness!.context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 1100,
      requestedFor: NOW + 2880,
    }).movement.reference;
    const movement = await fetch(`${base}/movements/${reference}`);
    expect(movement.status).toBe(200);
    const plan = await fetch(`${base}/movements/${reference}/plan?hours=12`);
    const body = (await plan.json()) as { windows: unknown[] };
    expect(body.windows.length).toBeGreaterThan(0);
  });

  it('gives 404 for a route nobody serves', async () => {
    const base = await start();
    const response = await fetch(`${base}/nowhere`);
    expect(response.status).toBe(404);
    expect((await response.json()) as { error: string }).toHaveProperty('error');
  });

  it('gives 405 for a method the route does not take', async () => {
    const base = await start();
    const response = await fetch(`${base}/board`, { method: 'POST' });
    expect(response.status).toBe(405);
  });

  it('writes an access log line per request', async () => {
    const lines: string[] = [];
    const base = await start((line) => lines.push(line));
    await fetch(`${base}/district`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('GET /district 200');
  });

  it('reads a query string', async () => {
    const base = await start();
    const response = await fetch(`${base}/tides/NARROWS?days=1`);
    const body = (await response.json()) as { extremes: unknown[] };
    expect(body.extremes.length).toBeGreaterThan(2);
  });

  it('takes a port of zero and reports the one it got', async () => {
    const base = await start();
    expect(running?.port).toBeGreaterThan(0);
    expect(base).toContain('127.0.0.1');
  });
});
