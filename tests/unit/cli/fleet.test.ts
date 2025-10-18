import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CLEAN, EXIT_FINDINGS, EXIT_USAGE } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('vessels', () => {
  it('list every ship', async () => {
    harness = cliHarness();
    const result = await harness.invoke('vessels', 'list');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('ATLANTIC CROWN');
    expect(result.io.text()).toContain('ORE MONARCH');
  });

  it('filter by the start of the name', async () => {
    harness = cliHarness();
    const result = await harness.invoke('vessels', 'list', '--name', 'atlantic');
    expect(result.io.text()).toContain('ATLANTIC CROWN');
    expect(result.io.text()).not.toContain('ORE MONARCH');
  });

  it('show one in full', async () => {
    harness = cliHarness();
    const result = await harness.invoke('vessels', 'show', '9074729');
    expect(result.io.text()).toContain('pilotage units');
    expect(result.io.text()).toContain('block coefficient');
  });

  it('refuse a ship nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke('vessels', 'show', '9074717');
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.io.errorText()).toContain('no vessel with reference');
  });

  it('read as json', async () => {
    harness = cliHarness();
    const result = await harness.invoke('--format', 'json', 'vessels', 'list');
    expect(JSON.parse(result.io.text())).toHaveLength(3);
  });

  it('import a csv file', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'ships.csv');
    writeFileSync(
      path,
      `imo,name,type,length_cm,beam_cm,summer_draught_cm,air_draught_cm,gross_tonnage
9074717,coastal star,container,17000,2700,1050,3800,22000
`,
    );
    const result = await harness.invoke('vessels', 'import', path);
    expect(result.io.text()).toContain('wrote 1 ships');
    const after = await harness.invoke('vessels', 'show', '9074717');
    expect(after.io.text()).toContain('COASTAL STAR');
  });

  it('refuse a csv file with a bad row', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'ships.csv');
    writeFileSync(
      path,
      `imo,name,type,length_cm,beam_cm,summer_draught_cm,air_draught_cm,gross_tonnage
9999999,broken,container,1,1,1,1,1
`,
    );
    const result = await harness.invoke('vessels', 'import', path);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.io.errorText()).toContain('check digit');
  });
});

describe('agents', () => {
  it('list the accounts', async () => {
    harness = cliHarness();
    const result = await harness.invoke('agents', 'list');
    expect(result.io.text()).toContain('SEAWAY');
    expect(result.io.text()).toContain('Northern Agents');
  });

  it('show one', async () => {
    harness = cliHarness();
    const result = await harness.invoke('agents', 'show', 'SEAWAY');
    expect(result.io.text()).toContain('30 day terms');
  });

  it('refuse one nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke('agents', 'show', 'NOBODY');
    expect(result.io.errorText()).toContain('no account with reference');
  });

  it('import a csv file', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'agents.csv');
    writeFileSync(path, 'agent,name,terms_days\nCOASTLINE,Coastline Marine,45\n');
    const result = await harness.invoke('agents', 'import', path);
    expect(result.io.text()).toContain('wrote 1 accounts');
    const after = await harness.invoke('agents', 'show', 'COASTLINE');
    expect(after.io.text()).toContain('45 day terms');
  });
});
