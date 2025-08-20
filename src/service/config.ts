/**
 * The district's own settings, read from a json file.
 *
 * Everything here is a policy number that a district can change without a
 * release: the clearance rules, the surcharge rates, the rest limits, the
 * cancellation scale. The schema is strict about types and generous about
 * absence, so a file that names only what it wants to change is valid and
 * everything else falls back to the standing values.
 */

import { z } from 'zod';
import { InputError } from '../util/errors';
import { STANDARD_POLICY } from '../domain/ukc/policy';
import type { UkcPolicy } from '../domain/ukc/policy';
import { STANDARD_REST } from '../domain/roster/duty';
import type { RestRules } from '../domain/roster/duty';
import { STANDING_ORDERS } from '../domain/window/restriction';
import type { RestrictionRules } from '../domain/window/restriction';
import { STANDARD_SURCHARGES } from '../domain/tariff/surcharge';
import type { SurchargeRules } from '../domain/tariff/surcharge';
import { STANDARD_PENALTIES } from '../domain/tariff/penalty';
import type { PenaltyRules } from '../domain/tariff/penalty';
import { STANDARD_DETENTION } from '../domain/movement/times';
import type { DetentionRules } from '../domain/movement/times';
import { STANDARD_CALENDAR, makeCalendar } from '../domain/tariff/calendar';
import type { PortCalendar } from '../domain/tariff/calendar';

const wholeNonNegative = z.number().int().nonnegative();

const policySchema = z
  .object({
    id: z.string().optional(),
    percentOfDraught: wholeNonNegative.optional(),
    minimumNet: wholeNonNegative.optional(),
    hardBottomExtra: wholeNonNegative.optional(),
    dangerousCargoExtra: wholeNonNegative.optional(),
    waveResponse: wholeNonNegative.optional(),
    plannedHeel: wholeNonNegative.optional(),
    reportingStep: z.number().int().positive().optional(),
  })
  .strict();

const restSchema = z
  .object({
    minimumRest: wholeNonNegative.optional(),
    dailyCeiling: wholeNonNegative.optional(),
    weeklyCeiling: wholeNonNegative.optional(),
    longJob: wholeNonNegative.optional(),
    longJobRest: wholeNonNegative.optional(),
  })
  .strict();

const restrictionSchema = z
  .object({
    daylightUnits: wholeNonNegative.optional(),
    daylightDraught: wholeNonNegative.optional(),
    windCeiling: wholeNonNegative.optional(),
    visibilityFloor: wholeNonNegative.optional(),
    unitsPerTug: z.number().int().positive().optional(),
    thrusterCredit: wholeNonNegative.optional(),
    tugsAvailable: wholeNonNegative.optional(),
    oneWayUnits: wholeNonNegative.optional(),
  })
  .strict();

const surchargeSchema = z
  .object({
    night: wholeNonNegative.optional(),
    weekend: wholeNonNegative.optional(),
    holiday: wholeNonNegative.optional(),
    deepOver: wholeNonNegative.optional(),
    deep: wholeNonNegative.optional(),
    dangerous: wholeNonNegative.optional(),
    deadShip: wholeNonNegative.optional(),
    shortNoticeHours: wholeNonNegative.optional(),
    shortNotice: wholeNonNegative.optional(),
  })
  .strict();

const penaltySchema = z
  .object({
    steps: z
      .array(
        z.object({ noticeHours: wholeNonNegative, rate: wholeNonNegative.max(10000) }).strict(),
      )
      .optional(),
    afterBoarding: wholeNonNegative.max(10000).optional(),
    districtCancels: wholeNonNegative.max(10000).optional(),
  })
  .strict();

const detentionSchema = z
  .object({
    grace: wholeNonNegative.optional(),
    block: z.number().int().positive().optional(),
    chargeable: z
      .array(z.enum(['vessel', 'berth', 'tug', 'weather', 'district', 'traffic']))
      .optional(),
  })
  .strict();

const calendarSchema = z
  .object({
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    nightFrom: wholeNonNegative.max(1439).optional(),
    nightTo: wholeNonNegative.max(1439).optional(),
    weekendDays: z.array(z.number().int().min(0).max(6)).optional(),
  })
  .strict();

export const configSchema = z
  .object({
    district: z.string().regex(/^[A-Z]{2,6}$/),
    databasePath: z.string().min(1).optional(),
    transitSpeed: z.number().int().positive().optional(),
    twilightMinutes: wholeNonNegative.optional(),
    taxRate: wholeNonNegative.max(5000).optional(),
    clearance: policySchema.optional(),
    rest: restSchema.optional(),
    restrictions: restrictionSchema.optional(),
    surcharges: surchargeSchema.optional(),
    penalties: penaltySchema.optional(),
    detention: detentionSchema.optional(),
    calendar: calendarSchema.optional(),
  })
  .strict();

export interface DistrictConfig {
  readonly district: string;
  readonly databasePath: string;
  readonly transitSpeed: number;
  readonly twilightMinutes: number;
  readonly taxRate: number;
  readonly clearance: UkcPolicy;
  readonly rest: RestRules;
  readonly restrictions: RestrictionRules;
  readonly surcharges: SurchargeRules;
  readonly penalties: PenaltyRules;
  readonly detention: DetentionRules;
  readonly calendar: PortCalendar;
}

export function parseConfig(input: unknown): DistrictConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new InputError(
      `the district settings are not valid: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    );
  }
  const raw = result.data;
  return {
    district: raw.district,
    databasePath: raw.databasePath ?? 'district.sqlite',
    transitSpeed: raw.transitSpeed ?? 80,
    twilightMinutes: raw.twilightMinutes ?? 30,
    taxRate: raw.taxRate ?? 0,
    clearance: { ...STANDARD_POLICY, ...raw.clearance } as UkcPolicy,
    rest: { ...STANDARD_REST, ...raw.rest },
    restrictions: { ...STANDING_ORDERS, ...raw.restrictions },
    surcharges: { ...STANDARD_SURCHARGES, ...raw.surcharges },
    penalties: { ...STANDARD_PENALTIES, ...raw.penalties },
    detention: { ...STANDARD_DETENTION, ...raw.detention },
    calendar: makeCalendar({ ...STANDARD_CALENDAR, ...raw.calendar }),
  };
}

export function parseConfigText(text: string, source = 'settings'): DistrictConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new InputError(`${source} is not json: ${(error as Error).message}`);
  }
  return parseConfig(parsed);
}

/** The settings a district that has changed nothing runs on. */
export function defaultConfig(district: string): DistrictConfig {
  return parseConfig({ district });
}
