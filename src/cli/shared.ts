/**
 * The pieces every command needs: the settings file, the open district, and the
 * options that appear on more than one command.
 */

import { readFileSync } from 'node:fs';
import { InputError } from '../util/errors';
import type { Minute } from '../util/clock';
import { parseInstant, parseLocal } from '../util/clock';
import type { DistrictConfig } from '../service/config';
import { defaultConfig, parseConfigText } from '../service/config';
import type { Context } from '../service/context';
import { openContext } from '../service/context';

export interface GlobalOptions {
  readonly config?: string;
  readonly district?: string;
  readonly database?: string;
  readonly format?: string;
  readonly now?: string;
}

export function loadConfig(options: GlobalOptions): DistrictConfig {
  const base =
    options.config === undefined
      ? defaultConfig(options.district ?? 'KLR')
      : parseConfigText(readFileSync(options.config, 'utf8'), options.config);
  return {
    ...base,
    ...(options.district === undefined ? {} : { district: options.district }),
    ...(options.database === undefined ? {} : { databasePath: options.database }),
  };
}

export function openFor(options: GlobalOptions): Context {
  const config = loadConfig(options);
  const now = options.now === undefined ? undefined : (): number => parseInstant(options.now ?? '');
  return openContext(config, { ...(now === undefined ? {} : { now }) });
}

/** Read a time written either as an instant or as district local time. */
export function readTime(value: string, offset: number): Minute {
  const trimmed = value.trim();
  if (/(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return parseInstant(trimmed);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseLocal(`${trimmed}T00:00`, offset);
  }
  return parseLocal(trimmed, offset);
}

export function readInteger(value: string, what: string): number {
  if (!/^-?\d+$/.test(value.trim())) {
    throw new InputError(`${what} must be a whole number, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

export function readMetres(value: string, what: string): number {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new InputError(`${what} must be a depth in metres, got ${JSON.stringify(value)}`);
  }
  const [whole, fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}
