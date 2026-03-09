/**
 * What a new tariff would have done to last year.
 *
 * The board asks for a rate rise as a percentage and then asks what it means,
 * which is a different question: a rise in the band charge and a rise in the per
 * unit rate fall on completely different ships. So the district reprices the
 * movements it actually ran on the proposed book and reports the difference, by
 * agent, because that is the conversation the agents will start.
 */

import { InputError } from '../util/errors';
import type { Interval } from '../util/interval';
import type { Cents } from '../util/units';
import { applyBps } from '../util/units';
import type { TariffBook, UnitBand } from '../domain/tariff/book';
import { makeBook } from '../domain/tariff/book';
import { assessMovement } from '../domain/tariff/assess';
import { noticeHours } from '../domain/movement/movement';
import { requireAccount, requireVessel } from '../storage/fleet-store';
import { findTimes, movementsInWindow } from '../storage/movement-store';
import { detentionBlocks } from '../domain/movement/times';
import type { Context } from './context';
import { bookForMovement } from './settlement';

/** Raise every charge in a book by a percentage in basis points. */
export function raiseBook(
  book: TariffBook,
  id: string,
  basisPoints: number,
  effectiveFrom: number,
): TariffBook {
  if (!Number.isInteger(basisPoints)) {
    throw new InputError('a rise is a whole number of basis points');
  }
  const bands: UnitBand[] = book.bands.map((band) => ({
    upTo: band.upTo,
    charge: band.charge + applyBps(band.charge, basisPoints),
    perUnit: band.perUnit + applyBps(band.perUnit, basisPoints),
  }));
  return makeBook({
    id,
    effectiveFrom,
    currency: book.currency,
    bands,
    minimumCharge: book.minimumCharge + applyBps(book.minimumCharge, basisPoints),
    detentionBlock: book.detentionBlock + applyBps(book.detentionBlock, basisPoints),
    boatFee: book.boatFee + applyBps(book.boatFee, basisPoints),
    adminFee: book.adminFee + applyBps(book.adminFee, basisPoints),
    kindMultiplier: book.kindMultiplier,
  });
}

export interface AgentEffect {
  readonly agent: string;
  readonly movements: number;
  readonly before: Cents;
  readonly after: Cents;
  readonly difference: Cents;
  /** The change as basis points of what they paid. */
  readonly rate: number;
}

export interface RateStudy {
  readonly period: Interval;
  readonly book: string;
  readonly movements: number;
  readonly before: Cents;
  readonly after: Cents;
  readonly difference: Cents;
  readonly agents: readonly AgentEffect[];
}

function priceOn(context: Context, reference: string, book: TariffBook): Cents {
  const movement = movementsInWindow(context.db, 0, Number.MAX_SAFE_INTEGER).find(
    (each) => each.reference === reference,
  );
  if (movement === undefined) {
    throw new InputError(`there is no movement ${reference}`);
  }
  const vessel = requireVessel(context.db, movement.vessel);
  const account = requireAccount(context.db, movement.agent);
  const times = findTimes(context.db, reference);
  return assessMovement({
    book,
    calendar: context.config.calendar,
    offset: context.district.offset,
    vessel,
    kind: movement.kind,
    draught: movement.draught,
    at: movement.plannedFor ?? movement.requestedFor,
    noticeHours: noticeHours(movement),
    detentionBlocks: times === undefined ? 0 : detentionBlocks(times, context.config.detention),
    discount: account.discount,
    surcharges: context.config.surcharges,
    penalties: context.config.penalties,
  }).total;
}

/** Reprice a period on a proposed book and report what changes. */
export function studyRates(context: Context, period: Interval, proposed: TariffBook): RateStudy {
  const movements = movementsInWindow(context.db, period.from, period.to).filter(
    (movement) => movement.status === 'completed',
  );
  const byAgent = new Map<string, AgentEffect>();
  let before = 0;
  let after = 0;
  for (const movement of movements) {
    const current = bookForMovement(context, movement);
    const wasCharged = priceOn(context, movement.reference, current);
    const wouldBe = priceOn(context, movement.reference, proposed);
    before += wasCharged;
    after += wouldBe;
    const held = byAgent.get(movement.agent) ?? {
      agent: movement.agent,
      movements: 0,
      before: 0,
      after: 0,
      difference: 0,
      rate: 0,
    };
    const nextBefore = held.before + wasCharged;
    const nextAfter = held.after + wouldBe;
    byAgent.set(movement.agent, {
      agent: movement.agent,
      movements: held.movements + 1,
      before: nextBefore,
      after: nextAfter,
      difference: nextAfter - nextBefore,
      rate: nextBefore === 0 ? 0 : Math.round(((nextAfter - nextBefore) / nextBefore) * 10000),
    });
  }
  return {
    period,
    book: proposed.id,
    movements: movements.length,
    before,
    after,
    difference: after - before,
    agents: [...byAgent.values()].sort(
      (a, b) => b.difference - a.difference || a.agent.localeCompare(b.agent),
    ),
  };
}

/** The rise as the board would quote it, in basis points of the whole take. */
export function overallRate(study: RateStudy): number {
  if (study.before === 0) {
    return 0;
  }
  return Math.round((study.difference / study.before) * 10000);
}
