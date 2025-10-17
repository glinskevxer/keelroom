import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatInstant } from '../../src/util/clock';
import { migrate } from '../../src/storage/migrate';
import { closeDatabase, openDatabase } from '../../src/storage/database';
import { saveDistrict } from '../../src/storage/district-store';
import { saveAccount, saveVessel } from '../../src/storage/fleet-store';
import { saveBoard, savePilot } from '../../src/storage/roster-store';
import { saveBook } from '../../src/storage/billing-store';
import { makeAccount } from '../../src/domain/billing/account';
import { makeBoard } from '../../src/domain/roster/board';
import { makeBook } from '../../src/domain/tariff/book';
import { run } from '../../src/cli/program';
import { recordingIo } from '../../src/cli/output';
import type { Recorder } from '../../src/cli/output';
import { CROWN, LAUNCH, MONARCH, NOW, PILOTS } from './context';
import { POSITION, testDistrict } from './district';

export interface CliHarness {
  readonly directory: string;
  readonly databasePath: string;
  readonly configPath: string;
  invoke(...argv: string[]): Promise<{ code: number; io: Recorder }>;
  close(): void;
}

export const TARIFF = makeBook({
  id: 'T-2025-A',
  effectiveFrom: NOW - 1440 * 90,
  bands: [
    { upTo: 100, charge: 45000, perUnit: 0 },
    { upTo: 1400, charge: 45000, perUnit: 320 },
  ],
  minimumCharge: 40000,
  detentionBlock: 12000,
  boatFee: 25000,
  adminFee: 3500,
  kindMultiplier: { shift: 700 },
});

/** A district file on disk with the test district loaded into it. */
export function cliHarness(settings: Record<string, unknown> = {}): CliHarness {
  const directory = mkdtempSync(join(tmpdir(), 'keelroom-cli-'));
  const databasePath = join(directory, 'district.sqlite');
  const configPath = join(directory, 'keelroom.json');
  const db = openDatabase(databasePath);
  migrate(db);
  saveDistrict(db, { district: testDistrict(), position: POSITION });
  saveVessel(db, CROWN);
  saveVessel(db, LAUNCH);
  saveVessel(db, MONARCH);
  saveAccount(db, makeAccount({ agent: 'SEAWAY', name: 'Seaway Agencies', creditLimit: 5000000 }));
  saveAccount(db, makeAccount({ agent: 'NORTH', name: 'Northern Agents' }));
  for (const pilot of PILOTS) {
    savePilot(db, pilot);
  }
  saveBoard(db, makeBoard(PILOTS));
  saveBook(db, TARIFF);
  closeDatabase(db);
  writeFileSync(
    configPath,
    JSON.stringify({ district: 'KLR', databasePath, ...settings }, null, 2),
  );
  return {
    directory,
    databasePath,
    configPath,
    async invoke(...argv: string[]): Promise<{ code: number; io: Recorder }> {
      const io = recordingIo();
      const code = await run(['--config', configPath, '--now', formatInstant(NOW), ...argv], {
        io,
      });
      return { code, io };
    },
    close(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
