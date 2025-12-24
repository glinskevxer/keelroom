import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  engines: Record<string, string>;
};

describe('the workflow', () => {
  it('runs every gate the district cares about', () => {
    for (const job of [
      'lint:',
      'test:',
      'coverage:',
      'docs:',
      'release:',
      'advisories:',
      'image:',
    ]) {
      expect(workflow).toContain(job);
    }
  });

  it('runs the tests on two node versions', () => {
    expect(workflow).toContain("node: ['20.18.1', '22.13.1']");
  });

  it('runs only scripts the package has', () => {
    const scripts = [...workflow.matchAll(/npm run ([a-z:-]+)/g)].map((match) => match[1] ?? '');
    for (const script of new Set(scripts)) {
      expect(manifest.scripts[script]).toBeDefined();
    }
  });

  it('cancels a run that a newer push has overtaken', () => {
    expect(workflow).toContain('cancel-in-progress: true');
  });

  it('asks for no more permission than reading the code', () => {
    expect(workflow).toContain('contents: read');
  });
});

describe('the image', () => {
  it('builds and then throws the build tools away', () => {
    expect(dockerfile).toContain('AS build');
    expect(dockerfile).toContain('AS runtime');
    expect(dockerfile).toContain('npm prune --omit=dev');
  });

  it('runs as somebody other than root', () => {
    expect(dockerfile).toContain('USER node');
  });

  it('pins the same node the workflow uses', () => {
    expect(dockerfile).toContain('node:20.18.1-bookworm-slim');
    expect(manifest.engines.node).toBe('>=20.11.0');
  });

  it('keeps the district file out of the image', () => {
    expect(dockerfile).toContain('VOLUME ["/data"]');
  });
});
