/**
 * The http service.
 *
 * Node's own server, one router, and a handful of things that have to be right
 * whatever is behind them: a request body is never read because nothing here
 * accepts one, the response is always json, and a handler that throws becomes a
 * status rather than a hung socket.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Context } from '../service/context';
import { buildRouter } from './routes';
import { errorResponse, parseQuery } from './router';
import type { Router } from './router';

export interface ServeOptions {
  readonly port?: number;
  readonly host?: string;
  /** Called with each request line, for the access log. */
  readonly log?: (line: string) => void;
}

export interface RunningServer {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

export function buildServer(context: Context, options: ServeOptions = {}): Server {
  const router: Router = buildRouter(context);
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const started = Date.now();
    const url = new URL(request.url ?? '/', 'http://district.invalid');
    let result;
    try {
      result = router.handle({
        method: request.method ?? 'GET',
        path: url.pathname,
        query: parseQuery(url.search),
        params: {},
      });
    } catch (error) {
      result = errorResponse(error);
    }
    const body = JSON.stringify(result.body, null, 2);
    response.writeHead(result.status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': 'no-store',
    });
    response.end(body);
    options.log?.(
      `${request.method ?? 'GET'} ${url.pathname}${url.search} ${result.status} ${Date.now() - started}ms`,
    );
  });
}

export async function serve(context: Context, options: ServeOptions = {}): Promise<RunningServer> {
  const server = buildServer(context, options);
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8080, options.host ?? '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
  return {
    server,
    port,
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}
