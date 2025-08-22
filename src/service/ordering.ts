/**
 * Taking an order from an agent.
 *
 * The order desk checks four things before a reference is issued: that the ship
 * is on the books, that the agent is in a state to order, that the places named
 * exist, and that the ship could physically be where she says she is going. It
 * does not check the tide. A ship that cannot make the tide still gets an order
 * and then gets refused with a reason, because the agent needs the reference to
 * quote in the argument about it.
 */

import { InputError, NotFoundError } from '../util/errors';
import type { Minute } from '../util/clock';
import type { Cm } from '../util/units';
import type { Finding } from '../util/finding';
import { FindingLog } from '../util/finding';
import { findBerth } from '../domain/chart/district';
import { takesLength } from '../domain/chart/berth';
import type { Movement, MovementKind } from '../domain/movement/movement';
import { makeMovement, nextReference } from '../domain/movement/movement';
import { apply } from '../domain/movement/lifecycle';
import { standing } from '../domain/billing/account';
import { balanceFor } from '../domain/billing/ledger';
import { requireVessel, findAccount } from '../storage/fleet-store';
import { invoicesForAgent, creditsForAgent, allocationsFor } from '../storage/billing-store';
import { referencesIssuedIn, requireMovement, saveMovement } from '../storage/movement-store';
import type { Context } from './context';
import { localYear } from './context';

export interface OrderRequest {
  readonly kind: MovementKind;
  readonly vessel: string;
  readonly agent: string;
  readonly from: string;
  readonly to: string;
  readonly draught: Cm;
  readonly requestedFor: Minute;
  readonly notes?: readonly string[];
}

export interface OrderResult {
  readonly movement: Movement;
  readonly findings: readonly Finding[];
}

const SEA = 'SEA';

export function placeOrder(context: Context, request: OrderRequest): OrderResult {
  const log = new FindingLog();
  const vessel = requireVessel(context.db, request.vessel);
  const account = findAccount(context.db, request.agent);
  if (account === undefined) {
    throw new NotFoundError('account', request.agent);
  }
  const owed = balanceFor(
    request.agent,
    invoicesForAgent(context.db, request.agent),
    creditsForAgent(context.db, request.agent),
    allocationsFor(context.db, request.agent),
  );
  const where = standing(account, owed);
  if (!where.canOrder) {
    log.block('ORD-ACCT-01', 'the account cannot take another movement', {
      subject: request.agent,
      detail: { reason: where.reason, balance: where.balance },
    });
  }

  for (const place of [request.from, request.to]) {
    if (place === SEA) {
      continue;
    }
    const berth = findBerth(context.district, place);
    if (berth === undefined) {
      log.block('ORD-PLACE-02', 'the district has no such berth', { subject: place });
      continue;
    }
    if (!takesLength(berth, vessel.length)) {
      log.block('ORD-LENGTH-03', 'the ship is longer than the berth takes', {
        subject: place,
        detail: { length: vessel.length, limit: berth.maxLength },
      });
    }
  }

  if (request.draught > vessel.summerDraught) {
    log.block('ORD-DEEP-04', 'the declared draught is deeper than her summer marks', {
      detail: { declared: request.draught, marks: vessel.summerDraught },
    });
  }
  if (request.requestedFor < context.now()) {
    log.block('ORD-PAST-05', 'the time asked for has already gone');
  }
  if (log.clear() && request.requestedFor - context.now() < 240) {
    log.advise('ORD-SHORT-06', 'this is inside the short notice window and will be surcharged');
  }

  if (!log.clear()) {
    throw new InputError(
      `the order cannot be taken: ${log.sorted()[0]?.message ?? 'unknown reason'}`,
    );
  }

  const year = localYear(context, request.requestedFor);
  const reference = nextReference(year, referencesIssuedIn(context.db, year));
  const movement = makeMovement({
    reference,
    kind: request.kind,
    vessel: vessel.imo,
    agent: account.agent,
    from: request.from,
    to: request.to,
    draught: request.draught,
    orderedAt: context.now(),
    requestedFor: request.requestedFor,
    notes: request.notes,
  });
  saveMovement(context.db, movement);
  return { movement, findings: log.all() };
}

/** Change the time or the draught on an order that has not been confirmed. */
export function amendOrder(
  context: Context,
  reference: string,
  changes: { requestedFor?: Minute; draught?: Cm; notes?: readonly string[] },
): Movement {
  const movement = requireMovement(context.db, reference);
  if (movement.status !== 'ordered' && movement.status !== 'confirmed') {
    throw new InputError(`movement ${reference} is past the point of amendment`, {
      status: movement.status,
    });
  }
  const vessel = requireVessel(context.db, movement.vessel);
  const draught = changes.draught ?? movement.draught;
  if (draught > vessel.summerDraught) {
    throw new InputError('the amended draught is deeper than her summer marks');
  }
  const amended = makeMovement({
    ...movement,
    from: movement.from,
    to: movement.to,
    draught,
    requestedFor: changes.requestedFor ?? movement.requestedFor,
    notes: changes.notes ?? movement.notes,
    plannedFor: undefined,
    status: 'ordered',
  });
  saveMovement(context.db, amended);
  return amended;
}

export function cancelOrder(context: Context, reference: string, reason: string): Movement {
  const movement = requireMovement(context.db, reference);
  const cancelled = apply(movement, { to: 'cancelled', reason });
  saveMovement(context.db, cancelled);
  return cancelled;
}

export function refuseOrder(context: Context, reference: string, reason: string): Movement {
  const movement = requireMovement(context.db, reference);
  const refused = apply(movement, { to: 'refused', reason });
  saveMovement(context.db, refused);
  return refused;
}
