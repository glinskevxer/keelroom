/**
 * A very small router over the node standard library.
 *
 * The api is read only and it exists so the agents can see their own movements
 * without telephoning the desk. It is not a framework and it does not want to
 * be one: there are a dozen routes, no bodies to parse, and the whole surface is
 * json. Bringing a web framework in for that would add more to the security
 * surface than it saves in code.
 */

import { describeError, exitCodeOf, EXIT_FINDINGS, EXIT_USAGE } from '../util/errors';

export interface Request {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly params: Readonly<Record<string, string>>;
}

export interface Response {
  readonly status: number;
  readonly body: unknown;
}

export type Handler = (request: Request) => Response;

interface Route {
  readonly method: string;
  readonly pattern: readonly string[];
  readonly handler: Handler;
  readonly path: string;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      pattern: path.split('/').filter((part) => part !== ''),
      handler,
      path,
    });
    return this;
  }

  get(path: string, handler: Handler): this {
    return this.add('GET', path, handler);
  }

  /** Every route, for the index endpoint and for the tests. */
  list(): { method: string; path: string }[] {
    return this.routes.map((route) => ({ method: route.method, path: route.path }));
  }

  handle(request: Request): Response {
    const parts = request.path.split('/').filter((part) => part !== '');
    let pathMatched = false;
    for (const route of this.routes) {
      const params = match(route.pattern, parts);
      if (params === undefined) {
        continue;
      }
      pathMatched = true;
      if (route.method !== request.method.toUpperCase()) {
        continue;
      }
      try {
        return route.handler({ ...request, params });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (pathMatched) {
      return { status: 405, body: { error: 'that method is not allowed here' } };
    }
    return { status: 404, body: { error: `no route for ${request.path}` } };
  }
}

function match(
  pattern: readonly string[],
  parts: readonly string[],
): Record<string, string> | undefined {
  if (pattern.length !== parts.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index] ?? '';
    const actual = parts[index] ?? '';
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}

export function errorResponse(error: unknown): Response {
  const code = exitCodeOf(error);
  const status = code === EXIT_USAGE ? 400 : code === EXIT_FINDINGS ? 404 : 500;
  return { status, body: { error: describeError(error) } };
}

export function parseQuery(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    query[key] = value;
  }
  return query;
}

/** Read a whole number from the query string, with a default. */
export function queryInteger(request: Request, name: string, fallback: number): number {
  const value = request.query[name];
  if (value === undefined) {
    return fallback;
  }
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`${name} must be a whole number`);
  }
  return Number(value);
}
