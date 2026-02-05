/**
 * Writing the trail from the services.
 *
 * The context carries who is at the terminal, so a service records what it did
 * without every caller having to pass a name down. An action that wants a reason
 * and is given none is refused rather than recorded blank, because a blank
 * reason is what the trail exists to prevent.
 */

import { InputError } from '../util/errors';
import type { AuditAction, AuditEntry } from '../domain/audit/entry';
import { checkEntry, makeEntry } from '../domain/audit/entry';
import { lastEntries, record, trailBetween, trailBy, trailFor } from '../storage/audit-store';
import type { Context } from './context';

export function note(
  context: Context,
  action: AuditAction,
  subject: string,
  options: { note?: string; detail?: Record<string, string | number>; by?: string } = {},
): AuditEntry {
  const entry = makeEntry({
    at: context.now(),
    action,
    subject,
    by: options.by ?? context.operator,
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
  });
  const problems = checkEntry(entry);
  if (problems.length > 0) {
    throw new InputError(problems[0] ?? 'the audit entry is not complete');
  }
  record(context.db, entry);
  return entry;
}

export function trailOf(context: Context, subject: string): AuditEntry[] {
  return trailFor(context.db, subject);
}

export function recent(context: Context, limit = 20): AuditEntry[] {
  return lastEntries(context.db, limit);
}

export function trailOver(context: Context, from: number, to: number): AuditEntry[] {
  return trailBetween(context.db, from, to);
}

export function trailOfPerson(context: Context, by: string): AuditEntry[] {
  return trailBy(context.db, by);
}
