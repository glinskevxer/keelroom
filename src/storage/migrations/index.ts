import type { Db } from '../database';
import { up as district } from './001-district';

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly up: (db: Db) => void;
}

/**
 * Every migration the district has ever run, in order. Nothing is ever removed
 * from this list and nothing is ever edited once it has run anywhere, because
 * the only way a district database gets to the current schema is by replaying
 * it.
 */
export const MIGRATIONS: readonly Migration[] = [{ id: 1, name: 'district', up: district }];
