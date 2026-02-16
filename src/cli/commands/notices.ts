/**
 * keelroom notices: issue one, read the board, withdraw one.
 */

import type { Command } from 'commander';
import { NotFoundError } from '../../util/errors';
import { renderPairs } from '../../util/table';
import type { NoticeKind } from '../../domain/notice/notice';
import { makeNotice } from '../../domain/notice/notice';
import { noticeHeadlines, renderNotices, valueOf } from '../../report/notices';
import {
  findNotice,
  nextNoticeId,
  noticesOn,
  saveNotice,
  standingNotices,
  withdrawNotice,
} from '../../storage/notice-store';
import { localYear } from '../../service/context';
import type { Io } from '../output';
import { withDistrict } from '../run';
import { readInteger, readTime } from '../shared';

const KINDS: readonly NoticeKind[] = [
  'closure',
  'draught-cap',
  'daylight-only',
  'speed-cap',
  'no-overtaking',
  'information',
];

export function registerNotices(program: Command, io: Io): void {
  const notices = program.command('notices').description('notices to mariners');

  notices
    .command('issue <subject> <text...>')
    .description(`issue a notice, kind one of ${KINDS.join(', ')}`)
    .requiredOption('--kind <kind>', 'what sort of notice')
    .requiredOption('--from <time>', 'when it starts')
    .requiredOption('--to <time>', 'when it ends')
    .option('--value <value>', 'centimetres for a draught cap, tenths of a knot for a speed cap')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          subject: string,
          text: string[],
          local: { kind: string; from: string; to: string; value?: string },
        ) => {
          const kind = KINDS.find((each) => each === local.kind);
          if (kind === undefined) {
            throw new NotFoundError('notice kind', local.kind);
          }
          const offset = context.district.offset;
          const notice = makeNotice({
            id: nextNoticeId(context.db, localYear(context, context.now())),
            kind,
            subject,
            from: readTime(local.from, offset),
            to: readTime(local.to, offset),
            text: text.join(' '),
            ...(local.value === undefined ? {} : { value: readInteger(local.value, 'value') }),
            issuedAt: context.now(),
          });
          saveNotice(context.db, notice);
          say(`${notice.id} issued`, notice);
        },
      ),
    );

  notices
    .command('list')
    .description('the notice board')
    .option('--subject <subject>', 'only the notices binding on this reach or berth')
    .option('--headlines', 'only what is in force now, one line each')
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, local: { subject?: string; headlines?: boolean }) => {
          const board =
            local.subject === undefined
              ? standingNotices(context.db)
              : noticesOn(context.db, local.subject);
          const reportOptions = { offset: context.district.offset, now: context.now() };
          if (local.headlines === true) {
            const lines = noticeHeadlines(board, reportOptions);
            say(lines.length === 0 ? 'nothing in force' : lines.join('\n'), lines);
            return;
          }
          say(renderNotices(board, reportOptions), board);
        },
      ),
    );

  notices
    .command('show <id>')
    .description('one notice')
    .action(
      withDistrict(program, io, ({ context, say }, id: string) => {
        const notice = findNotice(context.db, id);
        if (notice === undefined) {
          throw new NotFoundError('notice', id);
        }
        const offset = context.district.offset;
        const text = renderPairs([
          ['notice', notice.id],
          ['kind', notice.kind],
          ['subject', notice.subject],
          ['from', String(notice.period.from)],
          ['to', String(notice.period.to)],
          ['value', valueOf(notice) || 'none'],
          ['text', notice.text],
          ['offset', String(offset)],
        ]);
        say(text, notice);
      }),
    );

  notices
    .command('withdraw <id>')
    .description('lift a notice early, keeping it readable')
    .action(
      withDistrict(program, io, ({ context, say }, id: string) => {
        if (!withdrawNotice(context.db, id)) {
          throw new NotFoundError('notice', id);
        }
        say(`${id} withdrawn`, { id, withdrawn: true });
      }),
    );
}
