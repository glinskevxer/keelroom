/**
 * Who to ring, and who gets sent what.
 *
 * An agent is an account for the money and a list of people for everything else.
 * The distinction matters because the accounts department wants the invoices and
 * the operations desk wants the notices, and sending either to the other is how
 * a district gets a reputation for noise.
 */

import { InputError } from '../../util/errors';

export type ContactRole = 'operations' | 'accounts' | 'master' | 'emergency';

export interface Contact {
  readonly agent: string;
  readonly name: string;
  readonly role: ContactRole;
  readonly email?: string;
  readonly telephone?: string;
  /** Whether the notices go to this one. */
  readonly takesNotices: boolean;
}

const ROLES: readonly ContactRole[] = ['operations', 'accounts', 'master', 'emergency'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TELEPHONE = /^\+?[\d\s-]{6,20}$/;

export function contactRoles(): readonly ContactRole[] {
  return ROLES;
}

export function isContactRole(candidate: string): candidate is ContactRole {
  return (ROLES as readonly string[]).includes(candidate);
}

export function makeContact(input: {
  agent: string;
  name: string;
  role: string;
  email?: string;
  telephone?: string;
  takesNotices?: boolean;
}): Contact {
  if (!isContactRole(input.role)) {
    throw new InputError(`${input.role} is not a role the district keeps`);
  }
  if (input.name.trim() === '') {
    throw new InputError('a contact needs a name');
  }
  if (input.email !== undefined && !EMAIL.test(input.email)) {
    throw new InputError(`${input.email} is not an address`);
  }
  if (input.telephone !== undefined && !TELEPHONE.test(input.telephone)) {
    throw new InputError(`${input.telephone} is not a telephone number`);
  }
  if (input.email === undefined && input.telephone === undefined) {
    throw new InputError('a contact with neither an address nor a number is not a contact');
  }
  return {
    agent: input.agent,
    name: input.name.trim(),
    role: input.role,
    ...(input.email === undefined ? {} : { email: input.email }),
    ...(input.telephone === undefined ? {} : { telephone: input.telephone }),
    takesNotices: input.takesNotices ?? input.role === 'operations',
  };
}

export function contactsFor(contacts: readonly Contact[], agent: string): Contact[] {
  return contacts
    .filter((contact) => contact.agent === agent)
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}

export function inRole(contacts: readonly Contact[], role: ContactRole): Contact[] {
  return contacts.filter((contact) => contact.role === role);
}

/** The list a notice goes out to, which is addresses and nothing else. */
export function noticeList(contacts: readonly Contact[]): string[] {
  return [
    ...new Set(
      contacts
        .filter((contact) => contact.takesNotices && contact.email !== undefined)
        .map((contact) => contact.email ?? ''),
    ),
  ].sort();
}

/** The one to ring at three in the morning. */
export function emergencyNumber(contacts: readonly Contact[], agent: string): string | undefined {
  return contactsFor(contacts, agent).find(
    (contact) => contact.role === 'emergency' && contact.telephone !== undefined,
  )?.telephone;
}

export function describeContact(contact: Contact): string {
  const reach = contact.email ?? contact.telephone ?? '';
  const notices = contact.takesNotices ? ', takes notices' : '';
  return `${contact.name} (${contact.role}) ${reach}${notices}`;
}
