import type { Db } from '../../src/storage/database';
import { order, entryFor } from '../../src/domain/roster/board';
import { loadBoard } from '../../src/storage/roster-store';

export { order, entryFor };

export function loadBoardOrder(db: Db): string[] {
  return order(loadBoard(db));
}
