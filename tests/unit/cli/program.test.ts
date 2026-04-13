import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CLEAN, EXIT_USAGE } from '../../../src/util/errors';
import { run } from '../../../src/cli/program';
import { emit, readFormat, recordingIo } from '../../../src/cli/output';
import { VERSION } from '../../../src/version';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('the io recorder', () => {
  it('keeps what was written and what failed apart', () => {
    const io = recordingIo();
    io.write('one');
    io.write('two');
    io.fail('bad');
    expect(io.text()).toBe('one\ntwo');
    expect(io.errorText()).toBe('bad');
  });

  it('emits text or json as asked', () => {
    const io = recordingIo();
    emit(io, 'text', 'the table', { a: 1 });
    emit(io, 'json', 'the table', { a: 1 });
    expect(io.out[0]).toBe('the table');
    expect(JSON.parse(io.out[1] ?? '')).toEqual({ a: 1 });
  });

  it('reads the format flag, defaulting to text', () => {
    expect(readFormat('json')).toBe('json');
    expect(readFormat('text')).toBe('text');
    expect(readFormat(undefined)).toBe('text');
    expect(readFormat('nonsense')).toBe('text');
  });
});

describe('the program', () => {
  it('prints the version', async () => {
    harness = cliHarness();
    const result = await harness.invoke('--version');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain(VERSION);
  });

  it('prints help when asked', async () => {
    harness = cliHarness();
    const result = await harness.invoke('--help');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('pilotage dispatch');
  });

  it('refuses a command nobody has with the usage code', async () => {
    harness = cliHarness();
    const result = await harness.invoke('nonsense');
    expect(result.code).toBe(EXIT_USAGE);
  });
});

describe('doctor', () => {
  it('reports a healthy district', async () => {
    harness = cliHarness();
    const result = await harness.invoke('doctor');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('the file itself is sound');
    expect(result.io.text()).toContain('vessels');
  });

  it('reads as json when asked', async () => {
    harness = cliHarness();
    const result = await harness.invoke('--format', 'json', 'doctor');
    const parsed = JSON.parse(result.io.text());
    expect(parsed.problems).toEqual([]);
    expect(parsed.summary.vessels).toBe(3);
  });
});

describe('tides', () => {
  it('prints a table for a station', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tides', 'table', 'NARROWS', '--days', '1');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('HW');
    expect(result.io.text()).toContain('The Narrows');
  });

  it('prints a curve', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'tides',
      'curve',
      'NARROWS',
      '--hours',
      '3',
      '--step',
      '60',
    );
    expect(result.io.text().split('\n')).toHaveLength(7);
  });

  it('reads a start time in district local time', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'tides',
      'table',
      'NARROWS',
      '--from',
      '2025-04-02',
      '--days',
      '1',
    );
    expect(result.io.text()).toContain('2025-04-02');
  });

  it('refuses a station the district does not have', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tides', 'table', 'NOWHERE');
    expect(result.code).toBe(1);
    expect(result.io.errorText()).toContain('no tide station');
  });

  it('gives the extremes as json', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      '--format',
      'json',
      'tides',
      'table',
      'NARROWS',
      '--days',
      '1',
    );
    const parsed = JSON.parse(result.io.text());
    expect(parsed.station).toBe('NARROWS');
    expect(parsed.extremes.length).toBeGreaterThan(2);
  });
});

describe('init', () => {
  it('builds a district file from the example description', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'district.json');
    const fresh = join(harness.directory, 'fresh.sqlite');
    writeFileSync(
      path,
      readFileSync(join(__dirname, '..', '..', '..', 'docs', 'example-district.json'), 'utf8'),
    );
    const io = recordingIo();
    const code = await run(['--config', harness.configPath, '--database', fresh, 'init', path], {
      io,
    });
    expect(code).toBe(EXIT_CLEAN);
    expect(io.text()).toContain('district   KLR');
    expect(existsSync(fresh)).toBe(true);
  });

  it('refuses a description that is not one', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'district.json');
    writeFileSync(path, '{"code":"nope"}');
    const result = await harness.invoke('init', path);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.io.errorText()).toContain('not valid');
  });
});

describe('the doctor looking ahead', () => {
  it('says nothing wants attention in a fresh district', async () => {
    harness = cliHarness();
    const result = await harness.invoke('doctor');
    expect(result.io.text()).toContain('the file itself is sound');
    expect(result.io.text()).toContain('nothing wants attention');
  });

  it('reports an order whose time has gone', async () => {
    harness = cliHarness();
    await harness.invoke(
      'orders',
      'place',
      '9074705',
      'SEAWAY',
      '--kind',
      'arrival',
      '--from',
      'SEA',
      '--to',
      'GRAIN-3',
      '--draught',
      '6.00',
      '--at',
      '2025-04-01T05:00',
    );
    const io = recordingIo();
    await run(['--config', harness.configPath, '--now', '2025-04-01T14:00Z', 'doctor'], { io });
    expect(io.text()).toContain('HEALTH-LATE');
  });

  it('carries the health findings in the json', async () => {
    harness = cliHarness();
    const result = await harness.invoke('--format', 'json', 'doctor');
    const parsed = JSON.parse(result.io.text()) as { health: unknown[] };
    expect(Array.isArray(parsed.health)).toBe(true);
  });
});
