import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/util/errors';
import { orNotFound, requiring } from '../../../src/storage/lookup';

describe('or not found', () => {
  it('hands back what was found', () => {
    expect(orNotFound({ id: 'P07' }, 'pilot', 'P07')).toEqual({ id: 'P07' });
  });

  it('throws naming the kind and the reference', () => {
    expect(() => orNotFound(undefined, 'pilot', 'P99')).toThrow(NotFoundError);
    expect(() => orNotFound(undefined, 'pilot', 'P99')).toThrow('no pilot with reference P99');
  });

  it('hands back a value that is falsy but there', () => {
    expect(orNotFound(0, 'count', 'x')).toBe(0);
    expect(orNotFound('', 'name', 'x')).toBe('');
  });
});

describe('turning a finder into a requirer', () => {
  const rows = new Map([['P07', { id: 'P07', name: 'A Ferrier' }]]);
  const find = (_db: string, id: string): { id: string; name: string } | undefined => rows.get(id);
  const require_ = requiring(find, 'pilot', (_db, id) => id);

  it('passes the arguments through', () => {
    expect(require_('db', 'P07').name).toBe('A Ferrier');
  });

  it('throws for what is not there', () => {
    expect(() => require_('db', 'P99')).toThrow('no pilot with reference P99');
  });

  it('names the reference the way the caller does', () => {
    const byName = requiring(find, 'pilot', (_db, id) => `pilot ${id}`);
    expect(() => byName('db', 'P99')).toThrow('no pilot with reference pilot P99');
  });
});
