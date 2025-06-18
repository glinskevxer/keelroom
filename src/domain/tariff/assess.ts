/**
 * What one movement costs, start to finish.
 *
 * The order is fixed by the published tariff and it is not the order anybody
 * would guess. The base is worked out from the units and the kind. Every
 * surcharge is then a percentage of that base, never of the running total. The
 * boat and the administration fee are flat and take no surcharge at all. The
 * agent's discount comes off the pilotage and the surcharges but not off the
 * disbursements, and detention is added after the discount because it is a
 * charge for time rather than for pilotage.
 *
 * Getting that order wrong changes the answer by a few percent, which is exactly
 * the size of error nobody notices for a year.
 */

import type { Minute, Offset } from '../../util/clock';
import type { Cents } from '../../util/units';
import type { Cm } from '../../util/units';
import type { Vessel } from '../vessel/vessel';
import { pilotageUnits, unitsAtDraught } from '../vessel/vessel';
import type { MovementKind, MovementStatus } from '../movement/movement';
import type { TariffBook } from './book';
import type { PortCalendar } from './calendar';
import type { ChargeLine } from './charge';
import { applyDiscount, assessBase, lineFor, makeLine, totalOf } from './charge';
import type { PenaltyRules } from './penalty';
import { cancellationLines, detentionLines, STANDARD_PENALTIES } from './penalty';
import type { SurchargeRules } from './surcharge';
import { assessSurcharges, STANDARD_SURCHARGES } from './surcharge';

export interface AssessmentRequest {
  readonly book: TariffBook;
  readonly calendar: PortCalendar;
  readonly offset: Offset;
  readonly vessel: Vessel;
  readonly kind: MovementKind;
  readonly draught: Cm;
  /** When the movement ran, which decides the period surcharge. */
  readonly at: Minute;
  readonly noticeHours: number;
  readonly detentionBlocks?: number;
  readonly deadShip?: boolean;
  /** Discount held against the agent, in basis points. */
  readonly discount?: number;
  /** Charge the units at the declared draught rather than at the marks. */
  readonly chargeAtDeclaredDraught?: boolean;
  readonly surcharges?: SurchargeRules;
  readonly penalties?: PenaltyRules;
  /** Present when the movement was cancelled rather than run. */
  readonly cancelled?: { readonly status: MovementStatus; readonly byDistrict?: boolean };
}

export interface Assessment {
  readonly book: string;
  readonly units: number;
  readonly base: Cents;
  readonly surcharges: Cents;
  readonly discount: Cents;
  readonly disbursements: Cents;
  readonly detention: Cents;
  readonly total: Cents;
  readonly lines: readonly ChargeLine[];
}

export function assessMovement(request: AssessmentRequest): Assessment {
  const units =
    request.chargeAtDeclaredDraught === true
      ? unitsAtDraught(request.vessel, request.draught)
      : pilotageUnits(request.vessel);
  const base = assessBase(request.book, units, request.kind);
  const pilotage = lineFor(base.lines, 'PILOTAGE')?.amount ?? 0;
  const disbursementLines = base.lines.filter((line) => line.code !== 'PILOTAGE');

  if (request.cancelled !== undefined) {
    const cancellation = cancellationLines(request.penalties ?? STANDARD_PENALTIES, {
      base: pilotage,
      noticeHours: request.noticeHours,
      status: request.cancelled.status,
      byDistrict: request.cancelled.byDistrict === true,
    });
    const lines = [...cancellation, ...disbursementLines];
    return {
      book: request.book.id,
      units,
      base: pilotage,
      surcharges: 0,
      discount: 0,
      disbursements: totalOf(disbursementLines),
      detention: 0,
      total: totalOf(lines),
      lines,
    };
  }

  const surchargeLines = assessSurcharges(request.surcharges ?? STANDARD_SURCHARGES, pilotage, {
    vessel: request.vessel,
    draught: request.draught,
    at: request.at,
    offset: request.offset,
    calendar: request.calendar,
    noticeHours: request.noticeHours,
    deadShip: request.deadShip === true,
  });
  const surcharges = totalOf(surchargeLines);
  const discountable = pilotage + surcharges;
  const discounted = applyDiscount(discountable, request.discount ?? 0);
  const discount = discountable - discounted;
  const detention = detentionLines(request.book, request.detentionBlocks ?? 0);

  const lines: ChargeLine[] = [
    makeLine('PILOTAGE', `pilotage, ${units} units, ${request.kind}`, pilotage),
    ...surchargeLines,
  ];
  if (discount > 0) {
    lines.push(makeLine('DISCOUNT', 'agreement discount', -discount));
  }
  lines.push(...disbursementLines, ...detention);

  return {
    book: request.book.id,
    units,
    base: pilotage,
    surcharges,
    discount,
    disbursements: totalOf(disbursementLines),
    detention: totalOf(detention),
    total: totalOf(lines),
    lines,
  };
}

/** The same movement priced on another book, which is how a rate rise is shown. */
export function comparePriced(
  request: AssessmentRequest,
  other: TariffBook,
): { before: Cents; after: Cents; difference: Cents } {
  const before = assessMovement(request).total;
  const after = assessMovement({ ...request, book: other }).total;
  return { before, after, difference: after - before };
}

/** The lines in the order the invoice prints them, charges before credits. */
export function printedOrder(assessment: Assessment): ChargeLine[] {
  return [...assessment.lines].sort((a, b) => {
    const sign = Math.sign(b.amount) - Math.sign(a.amount);
    return sign === 0 ? 0 : sign;
  });
}
