import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CLEAN, EXIT_USAGE } from '../../../src/util/errors';
import { parseConfig } from '../../../src/service/config';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('showing the settings', () => {
  it('prints what is in force', async () => {
    harness = cliHarness();
    const result = await harness.invoke('config', 'show');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('district');
    expect(result.io.text()).toContain('clearance floor');
    expect(result.io.text()).toContain('surcharges');
  });

  it('shows an override from the file', async () => {
    harness = cliHarness({ clearance: { minimumNet: 90 }, taxRate: 1500 });
    const result = await harness.invoke('config', 'show');
    expect(result.io.text()).toContain('0.90 m');
    expect(result.io.text()).toContain('15.00 percent');
  });

  it('says when no holidays are published', async () => {
    harness = cliHarness();
    const result = await harness.invoke('config', 'show');
    expect(result.io.text()).toContain('holidays: none published');
  });

  it('reads as json', async () => {
    harness = cliHarness();
    const result = await harness.invoke('--format', 'json', 'config', 'show');
    const parsed = JSON.parse(result.io.text()) as { district: string };
    expect(parsed.district).toBe('KLR');
  });
});

describe('the template', () => {
  it('writes a file the settings reader accepts', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'template.json');
    const result = await harness.invoke('config', 'template', path, '--code', 'ABC');
    expect(result.io.text()).toContain('wrote a template');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(parsed.district).toBe('ABC');
    expect(() => parseConfig(parsed)).not.toThrow();
  });
});

describe('checking the settings', () => {
  it('says a good file is good', async () => {
    harness = cliHarness();
    const result = await harness.invoke('config', 'check');
    expect(result.io.text()).toContain('are valid');
  });

  it('refuses a file that is not', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'bad.json');
    writeFileSync(path, '{"district":"klr"}');
    const io = await harness.invoke('--config', path, 'config', 'check');
    expect(io.code).toBe(EXIT_USAGE);
    expect(io.io.errorText()).toContain('not valid');
  });
});
