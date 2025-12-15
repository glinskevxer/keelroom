import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  engines: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  bin: Record<string, string>;
  files: string[];
};

describe('the package', () => {
  it('pins every dependency to one version', () => {
    for (const range of Object.values({ ...manifest.dependencies, ...manifest.devDependencies })) {
      expect(range).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('carries only the three runtime dependencies', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      'better-sqlite3',
      'commander',
      'zod',
    ]);
  });

  it('names a node version', () => {
    expect(manifest.engines.node).toBeDefined();
  });

  it('points the binary and the files list at dist', () => {
    expect(manifest.bin.keelroom).toBe('dist/cli/main.js');
    expect(manifest.files).toContain('dist');
  });

  it('matches the version in the source', async () => {
    const { VERSION } = await import('../../../src/version');
    expect(VERSION).toBe(manifest.version);
  });
});
