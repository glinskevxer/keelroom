/**
 * What every use case needs to hand: the open database, the district as the
 * planner sees it, and the settings.
 *
 * The context is built once per command and passed down. Nothing below the
 * service layer knows there is a database at all, which is what lets the whole
 * domain be tested without one.
 */

import type { Db } from '../storage/database';
import { openDatabase } from '../storage/database';
import { migrate } from '../storage/migrate';
import { loadDistrict } from '../storage/district-store';
import type { District } from '../domain/chart/district';
import type { Position } from '../domain/window/daylight';
import type { DistrictConfig } from './config';

export interface Context {
  readonly db: Db;
  readonly district: District;
  readonly position: Position;
  readonly config: DistrictConfig;
  /** Whoever is at the terminal, which the audit trail records. */
  readonly operator: string;
  /** The clock, so tests can hold time still. */
  now(): number;
}

export interface ContextOptions {
  readonly now?: () => number;
  /** Bring the schema up to date before loading. */
  readonly migrateFirst?: boolean;
  /** Who is at the terminal. */
  readonly operator?: string;
}

export function contextFrom(db: Db, config: DistrictConfig, options: ContextOptions = {}): Context {
  if (options.migrateFirst === true) {
    migrate(db);
  }
  const stored = loadDistrict(db, config.district);
  return {
    db,
    district: stored.district,
    position: stored.position,
    config,
    operator: options.operator ?? 'unnamed',
    now: options.now ?? (() => Math.floor(Date.now() / 60000)),
  };
}

export function openContext(config: DistrictConfig, options: ContextOptions = {}): Context {
  const db = openDatabase(config.databasePath);
  return contextFrom(db, config, options);
}

export function closeContext(context: Context): void {
  if (context.db.open) {
    context.db.close();
  }
}

/** The district's own offset, which every rendering needs. */
export function offsetOf(context: Context): number {
  return context.district.offset;
}

/** The local year at a moment, which the reference series are numbered by. */
export function localYear(context: Context, at: number): number {
  const days = Math.floor((at + context.district.offset) / 1440);
  const date = new Date(days * 86400000);
  return date.getUTCFullYear();
}
