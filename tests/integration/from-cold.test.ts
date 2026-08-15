/**
 * A district from nothing, through the command line only.
 *
 * Every other test reaches into the services. This one uses what an operator
 * actually has: an empty directory, the example description, and the commands in
 * the order the help prints them. It is the test that would have caught the fact
 * that there was no way to create a district for the first ninety commits.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { EXIT_CLEAN } from '../../src/util/errors';
import { run } from '../../src/cli/program';
import { recordingIo } from '../../src/cli/output';
import type { Recorder } from '../../src/cli/output';

const example = readFileSync(join(__dirname, '..', '..', 'docs', 'example-district.json'), 'utf8');

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

interface Cold {
  readonly directory: string;
  readonly database: string;
  invoke(...argv: string[]): Promise<{ code: number; io: Recorder }>;
}

function fromCold(): Cold {
  directory = mkdtempSync(join(tmpdir(), 'keelroom-cold-'));
  const database = join(directory, 'district.sqlite');
  const held = directory;
  return {
    directory: held,
    database,
    async invoke(...argv: string[]): Promise<{ code: number; io: Recorder }> {
      const io = recordingIo();
      const code = await run(
        ['--database', database, '--district', 'KLR', '--now', '2026-04-01T08:00Z', ...argv],
        { io },
      );
      return { code, io };
    },
  };
}

describe('a district from an empty directory', () => {
  it('is built from the description in the docs', async () => {
    const cold = fromCold();
    const path = join(cold.directory, 'district.json');
    writeFileSync(path, example);
    const built = await cold.invoke('init', path);
    expect(built.code).toBe(EXIT_CLEAN);
    expect(built.io.text()).toContain('reaches    3');

    const shown = await cold.invoke('district', 'reaches');
    expect(shown.io.text()).toContain('LOWER-BAR');
    const tides = await cold.invoke('tides', 'table', 'NARROWS', '--days', '1');
    expect(tides.io.text()).toContain('HW');
    const doctor = await cold.invoke('doctor');
    expect(doctor.io.text()).toContain('the file itself is sound');
  });

  it('runs a ship through from order to invoice', async () => {
    const cold = fromCold();
    writeFileSync(join(cold.directory, 'district.json'), example);
    await cold.invoke('init', join(cold.directory, 'district.json'));

    // the reference lists the desk keeps
    writeFileSync(
      join(cold.directory, 'ships.csv'),
      `imo,name,type,length_cm,beam_cm,summer_draught_cm,air_draught_cm,gross_tonnage
9074729,atlantic crown,bulk,22500,3220,1250,4200,43000
`,
    );
    writeFileSync(
      join(cold.directory, 'agents.csv'),
      'agent,name,terms_days,credit_limit\nSEAWAY,Seaway Agencies,30,5000000\n',
    );
    await cold.invoke('vessels', 'import', join(cold.directory, 'ships.csv'));
    await cold.invoke('agents', 'import', join(cold.directory, 'agents.csv'));

    // a pilot, a board and a tariff
    const pilots = await cold.invoke('pilots', 'list');
    expect(pilots.io.text()).toContain('nobody on the roster');
    writeFileSync(
      join(cold.directory, 'book.json'),
      JSON.stringify({
        id: 'T-2026-A',
        effectiveFrom: '2026-01-01T00:00',
        bands: [{ upTo: 1400, charge: 45000, perUnit: 320 }],
        minimumCharge: 40000,
        detentionBlock: 12000,
        boatFee: 25000,
        adminFee: 3500,
      }),
    );
    const published = await cold.invoke('tariff', 'publish', join(cold.directory, 'book.json'));
    expect(published.io.text()).toContain('T-2026-A published');

    // the order, and what the tide allows
    const placed = await cold.invoke(
      'orders',
      'place',
      '9074729',
      'SEAWAY',
      '--kind',
      'arrival',
      '--from',
      'SEA',
      '--to',
      'GRAIN-3',
      '--draught',
      '10.50',
      '--at',
      '2026-04-03T06:00',
    );
    const reference = /M-\d{4}-\d{4}/.exec(placed.io.text())?.[0] ?? '';
    expect(reference).toBe('M-2026-0001');
    const plan = await cold.invoke('plan', 'show', reference);
    expect(plan.io.text()).toContain('controlling reach');
    const confirmed = await cold.invoke('plan', 'confirm', reference);
    expect(confirmed.io.text()).toContain('confirmed for');

    // there is nobody to give her to yet, which the district says plainly
    const noPilot = await cold.invoke('dispatch', 'assign', reference);
    expect(noPilot.io.errorText()).toContain('no pilot can take');

    // so the roster is put on the books and the board drawn up
    const db = (await import('../../src/storage/database')).openDatabase(cold.database);
    const { savePilot } = await import('../../src/storage/roster-store');
    const { makePilot } = await import('../../src/domain/roster/pilot');
    savePilot(
      db,
      makePilot({
        id: 'P02',
        name: 'A Ferrier',
        grade: 'unlimited',
        seniority: 1,
        endorsements: ['NIGHT', 'GRAIN-3'],
      }),
    );
    db.close();
    await cold.invoke('board-rebuild');
    const assigned = await cold.invoke('dispatch', 'assign', reference);
    expect(assigned.io.text()).toContain('P02');

    // she runs
    await cold.invoke('dispatch', 'boarded', reference, '--at', '2026-04-03T05:40');
    await cold.invoke('dispatch', 'underway', reference, '--at', '2026-04-03T05:55');
    const done = await cold.invoke('dispatch', 'complete', reference, '--at', '2026-04-03T08:10');
    expect(done.io.text()).toContain('on board');

    // and is billed
    const raised = await cold.invoke('billing', 'raise', 'SEAWAY', '--to', '2026-04-05T00:00');
    const invoice = /INV-\d{4}-\d{5}/.exec(raised.io.text())?.[0] ?? '';
    expect(invoice).toBe('INV-2026-00001');
    await cold.invoke('billing', 'issue', invoice);
    const statement = await cold.invoke('billing', 'statement', 'SEAWAY');
    expect(statement.io.text()).toContain('open invoices');

    // the day reads back as one page, and nothing is wrong with the file
    const bulletin = await cold.invoke('bulletin', '--day', '2026-04-03');
    expect(bulletin.io.text()).toContain('ATLANTIC CROWN');
    const audit = await cold.invoke('audit', 'show', reference);
    expect(audit.io.text()).toContain('pilot-assigned');
    const doctor = await cold.invoke('doctor');
    expect(doctor.io.text()).toContain('the file itself is sound');
  });

  it('says what is wrong rather than half building a district', async () => {
    const cold = fromCold();
    const path = join(cold.directory, 'broken.json');
    writeFileSync(path, JSON.stringify({ code: 'KLR', name: 'Keel Room' }));
    const built = await cold.invoke('init', path);
    expect(built.code).toBe(2);
    expect(built.io.errorText()).toContain('not valid');
    const shown = await cold.invoke('district', 'show');
    expect(shown.io.errorText()).toContain('has not been built');
  });
});
