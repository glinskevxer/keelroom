/**
 * What gets added to the base charge.
 *
 * Everything here is a percentage of the base, in basis points, and everything
 * is computed against the same base rather than against the running total. That
 * is a deliberate choice of the published tariff: surcharges do not compound, so
 * a deep tanker at night on a holiday pays the sum of three percentages of one
 * number rather than a percentage of a percentage.
 *
 * The one exception is the period surcharge, where only the dearest of night,
 * weekend and holiday applies, because a movement is only in one of them.
 */

import { InputError } from '../../util/errors';
import type { Minute, Offset } from '../../util/clock';
import type { Cents } from '../../util/units';
import { applyBps } from '../../util/units';
import type { Cm } from '../../util/units';
import type { Vessel } from '../vessel/vessel';
import { carriesDangerousCargo } from '../vessel/vessel';
import type { PortCalendar, PeriodClass } from './calendar';
import { periodClass } from './calendar';
import type { ChargeLine } from './charge';
import { makeLine } from './charge';

export interface SurchargeRules {
  readonly night: number;
  readonly weekend: number;
  readonly holiday: number;
  /** Draught over which the deep draught surcharge applies. */
  readonly deepOver: Cm;
  readonly deep: number;
  readonly dangerous: number;
  readonly deadShip: number;
  /** Notice under which the short notice surcharge applies, in hours. */
  readonly shortNoticeHours: number;
  readonly shortNotice: number;
}

export const STANDARD_SURCHARGES: SurchargeRules = {
  night: 2500,
  weekend: 3000,
  holiday: 5000,
  deepOver: 1150,
  deep: 1500,
  dangerous: 2000,
  deadShip: 10000,
  shortNoticeHours: 12,
  shortNotice: 2500,
};

export interface SurchargeContext {
  readonly vessel: Vessel;
  readonly draught: Cm;
  readonly at: Minute;
  readonly offset: Offset;
  readonly calendar: PortCalendar;
  readonly noticeHours: number;
  readonly deadShip?: boolean;
}

export function makeSurchargeRules(input: Partial<SurchargeRules> = {}): SurchargeRules {
  const rules = { ...STANDARD_SURCHARGES, ...input };
  for (const [name, value] of Object.entries(rules)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new InputError(
        `surcharge ${name} must be a whole number of basis points or centimetres`,
      );
    }
  }
  if (rules.night > 20000 || rules.weekend > 20000 || rules.holiday > 20000) {
    throw new InputError('a period surcharge over two hundred percent is not a surcharge');
  }
  return rules;
}

/** The dearest period surcharge that applies, which is the only one that does. */
export function periodSurcharge(
  rules: SurchargeRules,
  context: SurchargeContext,
): { period: PeriodClass; rate: number } {
  const period = periodClass(context.calendar, context.at, context.offset);
  switch (period) {
    case 'holiday':
      return { period, rate: rules.holiday };
    case 'weekend':
      return { period, rate: rules.weekend };
    case 'night':
      return { period, rate: rules.night };
    case 'ordinary':
      return { period, rate: 0 };
  }
}

/** Every surcharge line for a movement, each a percentage of the base. */
export function assessSurcharges(
  rules: SurchargeRules,
  base: Cents,
  context: SurchargeContext,
): ChargeLine[] {
  const lines: ChargeLine[] = [];
  const period = periodSurcharge(rules, context);
  if (period.rate > 0) {
    lines.push(
      makeLine(
        period.period.toUpperCase(),
        `${period.period} surcharge at ${(period.rate / 100).toFixed(1)} percent`,
        applyBps(base, period.rate),
      ),
    );
  }
  if (context.draught > rules.deepOver && rules.deep > 0) {
    lines.push(
      makeLine('DEEP', `deep draught over ${rules.deepOver} cm`, applyBps(base, rules.deep)),
    );
  }
  if (carriesDangerousCargo(context.vessel) && rules.dangerous > 0) {
    lines.push(makeLine('HAZARD', 'dangerous cargo', applyBps(base, rules.dangerous)));
  }
  if (context.deadShip === true && rules.deadShip > 0) {
    lines.push(makeLine('DEADSHIP', 'not under her own power', applyBps(base, rules.deadShip)));
  }
  if (context.noticeHours < rules.shortNoticeHours && rules.shortNotice > 0) {
    lines.push(
      makeLine(
        'SHORTNOTICE',
        `ordered on ${context.noticeHours} hours notice`,
        applyBps(base, rules.shortNotice),
      ),
    );
  }
  return lines;
}

/** The total rate applied, which the invoice prints as one figure. */
export function totalRate(rules: SurchargeRules, context: SurchargeContext): number {
  let rate = periodSurcharge(rules, context).rate;
  if (context.draught > rules.deepOver) {
    rate += rules.deep;
  }
  if (carriesDangerousCargo(context.vessel)) {
    rate += rules.dangerous;
  }
  if (context.deadShip === true) {
    rate += rules.deadShip;
  }
  if (context.noticeHours < rules.shortNoticeHours) {
    rate += rules.shortNotice;
  }
  return rate;
}

/** Whether moving a job an hour later would change what it costs. */
export function surchargeChangesAt(
  rules: SurchargeRules,
  context: SurchargeContext,
  later: Minute,
): boolean {
  const here = periodSurcharge(rules, context).rate;
  const there = periodSurcharge(rules, { ...context, at: later }).rate;
  return here !== there;
}
