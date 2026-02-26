import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CLEAN } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('showing the district', () => {
  it('names the district and its stations', async () => {
    harness = cliHarness();
    const result = await harness.invoke('district', 'show');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('Keel Room');
    expect(result.io.text()).toContain('semidiurnal');
  });

  it('lists the reaches seaward first with both depths', async () => {
    harness = cliHarness();
    const result = await harness.invoke('district', 'reaches');
    const lines = result.io.text().split('\n');
    expect(lines[3]).toContain('APPROACH');
    expect(lines.at(-1)).toContain('UPPER');
    expect(result.io.text()).toContain('planned');
  });

  it('lists the berths', async () => {
    harness = cliHarness();
    const result = await harness.invoke('district', 'berths');
    expect(result.io.text()).toContain('GRAIN-3');
    expect(result.io.text()).toContain('anchorage');
  });

  it('reads as json', async () => {
    harness = cliHarness();
    const result = await harness.invoke('--format', 'json', 'district', 'reaches');
    expect(JSON.parse(result.io.text())).toHaveLength(3);
  });
});

describe('chart updates', () => {
  it('apply a survey', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'survey.csv');
    writeFileSync(
      path,
      'reach,charted_depth_cm,surveyed_at,tolerance_cm\nLOWER-BAR,1265,2025-03-20T00:00Z,15\n',
    );
    const result = await harness.invoke('district', 'survey', path);
    expect(result.io.text()).toContain('1 reaches resurveyed');
    const reaches = await harness.invoke('district', 'reaches');
    expect(reaches.io.text()).toContain('12.65');
  });

  it('refuse a survey for a reach the district does not have', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'survey.csv');
    writeFileSync(path, 'reach,charted_depth_cm,surveyed_at\nNOWHERE,1200,2025-03-20T00:00Z\n');
    const result = await harness.invoke('district', 'survey', path);
    expect(result.io.errorText()).toContain('no reach NOWHERE');
  });

  it('replace the harmonic constants', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'harmonics.csv');
    writeFileSync(
      path,
      'station,constituent,amplitude_cm,phase_degrees\nNARROWS,M2,171,232.1\nNARROWS,S2,29,259.5\n',
    );
    const result = await harness.invoke('district', 'harmonics', path);
    expect(result.io.text()).toContain('2 constants loaded');
    const shown = await harness.invoke('district', 'show');
    expect(shown.io.text()).toContain('2 terms');
  });
});

describe('backing up', () => {
  it('writes a copy and reports what it wrote', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'copy.sqlite');
    const result = await harness.invoke('district', 'backup', path);
    expect(existsSync(path)).toBe(true);
    expect(result.io.text()).toContain('written to');
    expect(result.io.text()).toContain('schema version');
  });
});

describe('exports', () => {
  it('write the movement return to the terminal', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'district',
      'export',
      'movements',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '3',
    );
    expect(result.io.text().split('\n')[0]).toContain('reference,kind,status');
  });

  it('write to a file when asked', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'movements.csv');
    const result = await harness.invoke('district', 'export', 'movements', '--to-file', path);
    expect(result.io.text()).toContain('wrote 0 rows');
    expect(existsSync(path)).toBe(true);
  });

  it('refuse an export nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke('district', 'export', 'nonsense');
    expect(result.io.errorText()).toContain('no export with reference');
  });
});
