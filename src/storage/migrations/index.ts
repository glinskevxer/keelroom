import type { Db } from '../database';
import { up as district } from './001-district';
import { up as fleet } from './002-fleet';
import { up as roster } from './003-roster';
import { up as billing } from './004-billing';
import { up as notices } from './005-notices';
import { up as tugs } from './006-tugs';
import { up as audit } from './007-audit';
import { up as weather } from './008-weather';
import { up as papers } from './009-papers';
import { up as secondary } from './010-secondary';
import { up as cargo } from './011-cargo';
import { up as contacts } from './012-contacts';
import { up as deposits } from './013-deposits';

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
export const MIGRATIONS: readonly Migration[] = [
  { id: 1, name: 'district', up: district },
  { id: 2, name: 'fleet', up: fleet },
  { id: 3, name: 'roster', up: roster },
  { id: 4, name: 'billing', up: billing },
  { id: 5, name: 'notices', up: notices },
  { id: 6, name: 'tugs', up: tugs },
  { id: 7, name: 'audit', up: audit },
  { id: 8, name: 'weather', up: weather },
  { id: 9, name: 'papers', up: papers },
  { id: 10, name: 'secondary', up: secondary },
  { id: 11, name: 'cargo', up: cargo },
  { id: 12, name: 'contacts', up: contacts },
  { id: 13, name: 'deposits', up: deposits },
];
