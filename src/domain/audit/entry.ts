/**
 * The audit trail.
 *
 * Somebody moved a ship off the tide she was planned for, somebody overrode the
 * board, somebody credited an invoice. Each of those is a decision a person made
 * and each of them gets argued about later, so the district writes down what was
 * done, to what, by whom and why, and never edits a line of it afterwards.
 *
 * What is deliberately not here is a general change log of every field. A trail
 * that records everything is a trail nobody reads.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';

export type AuditAction =
  | 'order-placed'
  | 'order-amended'
  | 'order-cancelled'
  | 'movement-confirmed'
  | 'movement-replanned'
  | 'board-overridden'
  | 'pilot-assigned'
  | 'notice-issued'
  | 'notice-withdrawn'
  | 'invoice-issued'
  | 'invoice-credited'
  | 'payment-taken'
  | 'tariff-published'
  | 'survey-loaded';

export interface AuditEntry {
  readonly at: Minute;
  readonly action: AuditAction;
  /** What it was done to: a movement reference, an invoice number, a reach. */
  readonly subject: string;
  /** Who did it. The district runs on named accounts, not on shared logins. */
  readonly by: string;
  readonly note: string;
  readonly detail?: Readonly<Record<string, string | number>>;
}

const ACTIONS: readonly AuditAction[] = [
  'order-placed',
  'order-amended',
  'order-cancelled',
  'movement-confirmed',
  'movement-replanned',
  'board-overridden',
  'pilot-assigned',
  'notice-issued',
  'notice-withdrawn',
  'invoice-issued',
  'invoice-credited',
  'payment-taken',
  'tariff-published',
  'survey-loaded',
];

export function isAuditAction(candidate: string): candidate is AuditAction {
  return (ACTIONS as readonly string[]).includes(candidate);
}

export function auditActions(): readonly AuditAction[] {
  return ACTIONS;
}

export function makeEntry(input: {
  at: Minute;
  action: string;
  subject: string;
  by: string;
  note?: string;
  detail?: Record<string, string | number>;
}): AuditEntry {
  if (!isAuditAction(input.action)) {
    throw new InputError(`${input.action} is not an audited action`);
  }
  if (input.subject.trim() === '') {
    throw new InputError('an audit entry needs a subject');
  }
  if (input.by.trim() === '') {
    throw new InputError('an audit entry needs somebody who did it');
  }
  return {
    at: input.at,
    action: input.action,
    subject: input.subject.trim(),
    by: input.by.trim(),
    note: (input.note ?? '').trim(),
    ...(input.detail === undefined ? {} : { detail: { ...input.detail } }),
  };
}

/** The actions that always want a reason in words. */
const NEEDS_REASON: readonly AuditAction[] = [
  'order-cancelled',
  'movement-replanned',
  'board-overridden',
  'invoice-credited',
];

export function needsReason(action: AuditAction): boolean {
  return NEEDS_REASON.includes(action);
}

export function checkEntry(entry: AuditEntry): string[] {
  const problems: string[] = [];
  if (needsReason(entry.action) && entry.note === '') {
    problems.push(`${entry.action} on ${entry.subject} was recorded with no reason`);
  }
  return problems;
}

export function entriesFor(entries: readonly AuditEntry[], subject: string): AuditEntry[] {
  return entries
    .filter((entry) => entry.subject === subject)
    .sort((a, b) => a.at - b.at || a.action.localeCompare(b.action));
}

export function entriesBy(entries: readonly AuditEntry[], by: string): AuditEntry[] {
  return entries.filter((entry) => entry.by === by).sort((a, b) => a.at - b.at);
}

export function countByAction(entries: readonly AuditEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.action] = (counts[entry.action] ?? 0) + 1;
  }
  return counts;
}

export function describeEntry(entry: AuditEntry): string {
  const note = entry.note === '' ? '' : `: ${entry.note}`;
  return `${entry.action} ${entry.subject} by ${entry.by}${note}`;
}
