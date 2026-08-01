/**
 * keelroom explain: what a rule id means.
 *
 * Every finding carries an id and the ids are what the pilots and the agents
 * argue with. The handbook has them all, but a despatcher reading a refusal on
 * the screen wants the line rather than a document, so the command reads the
 * generated handbook and prints the row.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { NotFoundError } from '../../util/errors';
import { renderPairs, renderTable } from '../../util/table';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';

export interface HandbookRule {
  readonly id: string;
  readonly severity: string;
  readonly message: string;
  readonly file: string;
}

const ROW = /^\| `([A-Z][A-Z0-9-]+)` \| (\w+) \| ([^|]+?) \| `([^`]+)` \|$/gm;

/** Read the generated handbook, wherever the package was installed. */
export function readHandbook(root = join(__dirname, '..', '..', '..')): HandbookRule[] {
  const text = readFileSync(join(root, 'docs', 'rules.md'), 'utf8');
  return [...text.matchAll(ROW)].map((match) => ({
    id: match[1] ?? '',
    severity: match[2] ?? '',
    message: (match[3] ?? '').trim(),
    file: match[4] ?? '',
  }));
}

export function findRule(rules: readonly HandbookRule[], id: string): HandbookRule | undefined {
  return rules.find((rule) => rule.id === id.toUpperCase());
}

/** Every rule whose id starts with the prefix, which is how a family reads. */
export function rulesLike(rules: readonly HandbookRule[], prefix: string): HandbookRule[] {
  const wanted = prefix.toUpperCase();
  return rules.filter((rule) => rule.id.startsWith(wanted));
}

export function registerExplain(program: Command, io: Io): void {
  program
    .command('explain [rule]')
    .description('what a rule id means, or every rule in a family')
    .action((rule: string | undefined) => {
      const options = program.opts<GlobalOptions>();
      const format = readFormat(options.format);
      const rules = readHandbook();
      if (rule === undefined) {
        const text = renderTable(
          [{ heading: 'rule' }, { heading: 'severity' }, { heading: 'what it means', width: 52 }],
          rules.map((each) => [each.id, each.severity, each.message]),
          { title: `${rules.length} rules`, empty: 'the handbook is empty' },
        );
        emit(io, format, text, rules);
        return;
      }
      const found = findRule(rules, rule);
      if (found !== undefined) {
        const text = renderPairs([
          ['rule', found.id],
          ['severity', found.severity],
          ['what it means', found.message],
          ['where it fires', found.file],
        ]);
        emit(io, format, text, found);
        return;
      }
      const family = rulesLike(rules, rule);
      if (family.length === 0) {
        throw new NotFoundError('rule', rule);
      }
      const text = renderTable(
        [{ heading: 'rule' }, { heading: 'severity' }, { heading: 'what it means', width: 52 }],
        family.map((each) => [each.id, each.severity, each.message]),
        { title: `rules like ${rule.toUpperCase()}` },
      );
      emit(io, format, text, family);
    });
}
