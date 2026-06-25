import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import {
  contactRoles,
  contactsFor,
  describeContact,
  emergencyNumber,
  inRole,
  isContactRole,
  makeContact,
  noticeList,
} from '../../../src/domain/billing/contact';
import type { Contact } from '../../../src/domain/billing/contact';
import { makeAccount } from '../../../src/domain/billing/account';
import { migrate } from '../../../src/storage/migrate';
import {
  allContacts,
  contactsForAgent,
  deleteContact,
  saveAccount,
  saveContact,
} from '../../../src/storage/fleet-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

function contact(overrides: Partial<Parameters<typeof makeContact>[0]> = {}): Contact {
  return makeContact({
    agent: 'SEAWAY',
    name: 'J Hall',
    role: 'operations',
    email: 'hall@seaway.example',
    ...overrides,
  });
}

describe('a contact', () => {
  it('takes the notices by default when they are operations', () => {
    expect(contact().takesNotices).toBe(true);
    expect(contact({ role: 'accounts', name: 'A Reid' }).takesNotices).toBe(false);
  });

  it('lists the roles the district keeps', () => {
    expect(contactRoles()).toHaveLength(4);
    expect(isContactRole('accounts')).toBe(true);
    expect(isContactRole('porter')).toBe(false);
  });

  it('refuses one that cannot be reached', () => {
    expect(() => makeContact({ agent: 'SEAWAY', name: 'J Hall', role: 'operations' })).toThrow(
      /neither an address nor a number/,
    );
    expect(() => contact({ email: 'not an address' })).toThrow(/not an address/);
    expect(() => contact({ email: undefined, telephone: 'ring me' })).toThrow(/not a telephone/);
    expect(() => contact({ role: 'porter' })).toThrow(/not a role/);
    expect(() => contact({ name: '  ' })).toThrow(InputError);
  });

  it('describes itself in a line', () => {
    expect(describeContact(contact())).toBe(
      'J Hall (operations) hall@seaway.example, takes notices',
    );
  });
});

describe('the lists', () => {
  const contacts = [
    contact(),
    contact({ name: 'A Reid', role: 'accounts', email: 'reid@seaway.example' }),
    contact({ agent: 'NORTH', name: 'B Muir', email: 'muir@north.example' }),
    contact({
      agent: 'NORTH',
      name: 'C Watt',
      role: 'emergency',
      email: undefined,
      telephone: '+1 902 555 0100',
    }),
  ];

  it('give the contacts for one agent', () => {
    expect(contactsFor(contacts, 'SEAWAY').map((each) => each.name)).toEqual(['A Reid', 'J Hall']);
    expect(contactsFor(contacts, 'NOBODY')).toEqual([]);
  });

  it('filter by role', () => {
    expect(inRole(contacts, 'accounts')).toHaveLength(1);
  });

  it('build the notice list from the addresses only', () => {
    expect(noticeList(contacts)).toEqual(['hall@seaway.example', 'muir@north.example']);
  });

  it('find the number to ring at three in the morning', () => {
    expect(emergencyNumber(contacts, 'NORTH')).toBe('+1 902 555 0100');
    expect(emergencyNumber(contacts, 'SEAWAY')).toBeUndefined();
  });
});

describe('through the store', () => {
  function ready(): TempDatabase {
    temp = temporaryDatabase();
    migrate(temp.db);
    saveAccount(temp.db, makeAccount({ agent: 'SEAWAY', name: 'Seaway Agencies' }));
    return temp;
  }

  it('come back as they went in', () => {
    const one = ready();
    saveContact(one.db, contact());
    expect(contactsForAgent(one.db, 'SEAWAY')).toEqual([contact()]);
  });

  it('update rather than duplicate', () => {
    const one = ready();
    saveContact(one.db, contact());
    saveContact(one.db, contact({ email: 'hall2@seaway.example' }));
    expect(allContacts(one.db)).toHaveLength(1);
    expect(contactsForAgent(one.db, 'SEAWAY')[0]?.email).toBe('hall2@seaway.example');
  });

  it('refuse a contact against an agent nobody has', () => {
    const one = ready();
    expect(() => saveContact(one.db, contact({ agent: 'NOBODY' }))).toThrow(/FOREIGN KEY/);
  });

  it('delete one', () => {
    const one = ready();
    saveContact(one.db, contact());
    expect(deleteContact(one.db, 'SEAWAY', 'J Hall', 'operations')).toBe(true);
    expect(deleteContact(one.db, 'SEAWAY', 'J Hall', 'operations')).toBe(false);
  });
});
