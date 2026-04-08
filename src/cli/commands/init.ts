/**
 * keelroom init: make a district file from a description.
 */

import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { renderPairs } from '../../util/table';
import { openDatabase } from '../../storage/database';
import { createDistrict } from '../../service/setup';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { loadConfig } from '../shared';

export function registerInit(program: Command, io: Io): void {
  program
    .command('init <path>')
    .description('build a district file from a json description')
    .action((path: string) => {
      const options = program.opts<GlobalOptions>();
      const config = loadConfig(options);
      const db = openDatabase(config.databasePath);
      try {
        const result = createDistrict(db, JSON.parse(readFileSync(path, 'utf8')));
        const text = renderPairs([
          ['district', result.code],
          ['file', config.databasePath],
          ['stations', String(result.stations)],
          ['reaches', String(result.reaches)],
          ['berths', String(result.berths)],
          ['overheads', String(result.overheads)],
        ]);
        emit(io, readFormat(options.format), text, result);
      } finally {
        db.close();
      }
    });
}
