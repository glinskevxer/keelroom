import type { Db } from '../database';

/** The dates a pilot's licence and medical run out. */
export function up(db: Db): void {
  db.exec(`
    alter table pilot add column licence_expires integer;
    alter table pilot add column medical_expires integer;
  `);
}
