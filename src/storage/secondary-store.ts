/**
 * The secondary ports, which are rows rather than stations.
 */

import type { Db } from './database';
import { requiring } from './lookup';
import type { SecondaryPort } from '../domain/tide/secondary';
import { makeSecondary } from '../domain/tide/secondary';

interface SecondaryRow {
  id: string;
  name: string;
  standard: string;
  hw_offset: number;
  lw_offset: number;
  hw_factor: number;
  lw_factor: number;
  datum_shift_cm: number;
}

function toPort(row: SecondaryRow): SecondaryPort {
  return makeSecondary({
    id: row.id,
    name: row.name,
    standard: row.standard,
    highWaterOffset: row.hw_offset,
    lowWaterOffset: row.lw_offset,
    highWaterFactor: row.hw_factor,
    lowWaterFactor: row.lw_factor,
    datumShift: row.datum_shift_cm,
  });
}

export function saveSecondary(db: Db, port: SecondaryPort): void {
  db.prepare(
    `insert into secondary_port (id, name, standard, hw_offset, lw_offset, hw_factor, lw_factor,
      datum_shift_cm)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       name = excluded.name,
       standard = excluded.standard,
       hw_offset = excluded.hw_offset,
       lw_offset = excluded.lw_offset,
       hw_factor = excluded.hw_factor,
       lw_factor = excluded.lw_factor,
       datum_shift_cm = excluded.datum_shift_cm`,
  ).run(
    port.id,
    port.name,
    port.standard,
    port.highWaterOffset,
    port.lowWaterOffset,
    port.highWaterFactor,
    port.lowWaterFactor,
    port.datumShift,
  );
}

export function allSecondary(db: Db): SecondaryPort[] {
  const rows = db.prepare('select * from secondary_port order by id').all() as SecondaryRow[];
  return rows.map(toPort);
}

export function findSecondary(db: Db, id: string): SecondaryPort | undefined {
  const row = db.prepare('select * from secondary_port where id = ?').get(id) as
    | SecondaryRow
    | undefined;
  return row === undefined ? undefined : toPort(row);
}

export const requireSecondary = requiring(findSecondary, 'secondary port', (_db, id) => id);

export function secondaryOn(db: Db, standard: string): SecondaryPort[] {
  const rows = db
    .prepare('select * from secondary_port where standard = ? order by id')
    .all(standard) as SecondaryRow[];
  return rows.map(toPort);
}

export function deleteSecondary(db: Db, id: string): boolean {
  return db.prepare('delete from secondary_port where id = ?').run(id).changes > 0;
}
