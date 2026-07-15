import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routes } from '../../../scripts/build-api-reference';

const reference = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'api.md'), 'utf8');

describe('the api reference', () => {
  it('names every route the router serves', () => {
    for (const route of routes()) {
      expect(reference).toContain(`\`${route.path}\``);
    }
  });

  it('says what each one answers', () => {
    const rows = [...reference.matchAll(/^\| GET \| `([^`]+)` \| (.*) \|$/gm)];
    expect(rows.length).toBe(routes().length);
    for (const row of rows) {
      expect((row[2] ?? '').length).toBeGreaterThan(5);
    }
  });

  it('says it is generated and how to start the service', () => {
    expect(reference).toContain('Do not edit by hand');
    expect(reference).toContain('keelroom serve');
  });

  it('says what the statuses mean', () => {
    expect(reference).toContain('404');
    expect(reference).toContain('405');
  });

  it('serves nothing but reads', () => {
    expect(routes().every((route) => route.method === 'GET')).toBe(true);
  });
});
