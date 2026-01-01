/**
 * The notice board, printed.
 */

import type { Minute, Offset } from '../util/clock';
import { localDate } from '../util/clock';
import { renderTable } from '../util/table';
import { formatMetres } from '../util/units';
import type { Notice } from '../domain/notice/notice';
import { currentNotices, isInForce } from '../domain/notice/notice';

export interface NoticeOptions {
  readonly offset: Offset;
  readonly now: Minute;
  readonly title?: string;
}

export function valueOf(notice: Notice): string {
  if (notice.value === undefined) {
    return '';
  }
  if (notice.kind === 'draught-cap') {
    return `${formatMetres(notice.value)} m`;
  }
  if (notice.kind === 'speed-cap') {
    return `${(notice.value / 10).toFixed(1)} kn`;
  }
  return String(notice.value);
}

export function renderNotices(notices: readonly Notice[], options: NoticeOptions): string {
  const rows = notices.map((notice) => [
    notice.id,
    notice.kind,
    notice.subject,
    localDate(notice.period.from, options.offset),
    localDate(notice.period.to, options.offset),
    valueOf(notice),
    isInForce(notice, options.now) ? 'in force' : '',
    notice.text,
  ]);
  return renderTable(
    [
      { heading: 'notice' },
      { heading: 'kind' },
      { heading: 'subject' },
      { heading: 'from' },
      { heading: 'to' },
      { heading: 'value', align: 'right' },
      { heading: '' },
      { heading: 'text', width: 44 },
    ],
    rows,
    { title: options.title ?? 'notices', empty: 'no notices' },
  );
}

/** The one or two lines that go at the top of the daily sheet. */
export function noticeHeadlines(notices: readonly Notice[], options: NoticeOptions): string[] {
  return currentNotices(notices, options.now).map(
    (notice) => `${notice.subject}: ${notice.text} (${notice.id})`,
  );
}

export function countByKind(notices: readonly Notice[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const notice of notices) {
    counts[notice.kind] = (counts[notice.kind] ?? 0) + 1;
  }
  return counts;
}
