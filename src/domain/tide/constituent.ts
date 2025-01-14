/**
 * The harmonic constituents the district's tide tables are published from.
 *
 * Each one is a cosine term whose angular speed is fixed by astronomy and whose
 * amplitude and phase lag are fitted to a year of observations at a particular
 * gauge. The speed is not stored as an independent number: it is derived from
 * the Doodson numbers, and the tabulated value is kept beside it only so the
 * two can be checked against each other.
 */

/** Degrees per mean solar hour, for the six Doodson arguments. */
export const RATES = {
  /** mean lunar time */
  tau: 14.49205211,
  /** mean longitude of the moon */
  s: 0.54901653,
  /** mean longitude of the sun */
  h: 0.04106864,
  /** longitude of lunar perigee */
  p: 0.00464183,
  /** negative longitude of the ascending node */
  n: 0.00220641,
  /** longitude of solar perigee */
  p1: 0.00000196,
} as const;

/**
 * The node factor family a constituent belongs to. Anything solar is invariant,
 * so its factor is one and its correction is zero for all time.
 */
export type NodeFamily =
  | 'solar'
  | 'lunar-semidiurnal'
  | 'lunar-diurnal-o1'
  | 'lunar-diurnal-k1'
  | 'lunisolar-k2'
  | 'lunar-fortnightly'
  | 'lunar-monthly'
  | 'quarter-diurnal'
  | 'sixth-diurnal'
  | 'compound-ms4'
  | 'compound-mk3';

export interface Constituent {
  readonly name: string;
  /** i1 tau, i2 s, i3 h, i4 p, i5 N, i6 p1 */
  readonly doodson: readonly [number, number, number, number, number, number];
  /** Multiples of ninety degrees added to the equilibrium argument. */
  readonly phaseQuarters: number;
  /** Degrees per mean solar hour, as published. */
  readonly speed: number;
  readonly family: NodeFamily;
  readonly description: string;
}

const TABLE: readonly Constituent[] = [
  {
    name: 'M2',
    doodson: [2, 0, 0, 0, 0, 0],
    phaseQuarters: 0,
    speed: 28.9841042,
    family: 'lunar-semidiurnal',
    description: 'principal lunar semidiurnal',
  },
  {
    name: 'S2',
    doodson: [2, 2, -2, 0, 0, 0],
    phaseQuarters: 0,
    speed: 30.0,
    family: 'solar',
    description: 'principal solar semidiurnal',
  },
  {
    name: 'N2',
    doodson: [2, -1, 0, 1, 0, 0],
    phaseQuarters: 0,
    speed: 28.4397295,
    family: 'lunar-semidiurnal',
    description: 'larger lunar elliptic semidiurnal',
  },
  {
    name: 'K2',
    doodson: [2, 2, 0, 0, 0, 0],
    phaseQuarters: 0,
    speed: 30.0821373,
    family: 'lunisolar-k2',
    description: 'lunisolar semidiurnal',
  },
  {
    name: 'K1',
    doodson: [1, 1, 0, 0, 0, 0],
    phaseQuarters: -1,
    speed: 15.0410686,
    family: 'lunar-diurnal-k1',
    description: 'lunisolar diurnal',
  },
  {
    name: 'O1',
    doodson: [1, -1, 0, 0, 0, 0],
    phaseQuarters: 1,
    speed: 13.9430356,
    family: 'lunar-diurnal-o1',
    description: 'principal lunar diurnal',
  },
  {
    name: 'P1',
    doodson: [1, 1, -2, 0, 0, 0],
    phaseQuarters: 1,
    speed: 14.9589314,
    family: 'solar',
    description: 'principal solar diurnal',
  },
  {
    name: 'Q1',
    doodson: [1, -2, 0, 1, 0, 0],
    phaseQuarters: 1,
    speed: 13.3986609,
    family: 'lunar-diurnal-o1',
    description: 'larger lunar elliptic diurnal',
  },
  {
    name: 'NU2',
    doodson: [2, -1, 2, -1, 0, 0],
    phaseQuarters: 0,
    speed: 28.5125831,
    family: 'lunar-semidiurnal',
    description: 'larger lunar evectional',
  },
  {
    name: 'MU2',
    doodson: [2, -2, 2, 0, 0, 0],
    phaseQuarters: 0,
    speed: 27.9682084,
    family: 'lunar-semidiurnal',
    description: 'variational',
  },
  {
    name: 'L2',
    doodson: [2, 1, 0, -1, 0, 0],
    phaseQuarters: 2,
    speed: 29.5284789,
    family: 'lunar-semidiurnal',
    description: 'smaller lunar elliptic semidiurnal',
  },
  {
    name: 'T2',
    doodson: [2, 2, -3, 0, 0, 1],
    phaseQuarters: 0,
    speed: 29.9589333,
    family: 'solar',
    description: 'larger solar elliptic',
  },
  {
    name: 'M4',
    doodson: [4, 0, 0, 0, 0, 0],
    phaseQuarters: 0,
    speed: 57.9682084,
    family: 'quarter-diurnal',
    description: 'shallow water overtide of M2',
  },
  {
    name: 'M6',
    doodson: [6, 0, 0, 0, 0, 0],
    phaseQuarters: 0,
    speed: 86.9523127,
    family: 'sixth-diurnal',
    description: 'shallow water overtide of M2',
  },
  {
    name: 'MS4',
    doodson: [4, 2, -2, 0, 0, 0],
    phaseQuarters: 0,
    speed: 58.9841042,
    family: 'compound-ms4',
    description: 'shallow water quarter diurnal',
  },
  {
    name: 'MN4',
    doodson: [4, -1, 0, 1, 0, 0],
    phaseQuarters: 0,
    speed: 57.4238337,
    family: 'quarter-diurnal',
    description: 'shallow water quarter diurnal',
  },
  {
    name: 'MK3',
    doodson: [3, 1, 0, 0, 0, 0],
    phaseQuarters: -1,
    speed: 44.0251729,
    family: 'compound-mk3',
    description: 'shallow water terdiurnal',
  },
  {
    name: 'S4',
    doodson: [4, 4, -4, 0, 0, 0],
    phaseQuarters: 0,
    speed: 60.0,
    family: 'solar',
    description: 'shallow water overtide of S2',
  },
  {
    name: 'MF',
    doodson: [0, 2, 0, 0, 0, 0],
    phaseQuarters: 0,
    speed: 1.0980331,
    family: 'lunar-fortnightly',
    description: 'lunar fortnightly',
  },
  {
    name: 'MM',
    doodson: [0, 1, 0, -1, 0, 0],
    phaseQuarters: 0,
    speed: 0.5443747,
    family: 'lunar-monthly',
    description: 'lunar monthly',
  },
  {
    name: 'SSA',
    doodson: [0, 0, 2, 0, 0, 0],
    phaseQuarters: 0,
    speed: 0.0821373,
    family: 'solar',
    description: 'solar semiannual',
  },
  {
    name: 'SA',
    doodson: [0, 0, 1, 0, 0, 0],
    phaseQuarters: 0,
    speed: 0.0410686,
    family: 'solar',
    description: 'solar annual',
  },
];

const BY_NAME = new Map(TABLE.map((constituent) => [constituent.name, constituent]));

export function knownConstituents(): readonly Constituent[] {
  return TABLE;
}

export function constituentNames(): string[] {
  return TABLE.map((constituent) => constituent.name);
}

export function isKnownConstituent(name: string): boolean {
  return BY_NAME.has(name.toUpperCase());
}

export function findConstituent(name: string): Constituent | undefined {
  return BY_NAME.get(name.toUpperCase());
}

export function requireConstituent(name: string): Constituent {
  const constituent = findConstituent(name);
  if (constituent === undefined) {
    throw new Error(`unknown tidal constituent ${JSON.stringify(name)}`);
  }
  return constituent;
}

/** The speed the Doodson numbers imply, in degrees per mean solar hour. */
export function derivedSpeed(constituent: Constituent): number {
  const [tau, s, h, p, n, p1] = constituent.doodson;
  return tau * RATES.tau + s * RATES.s + h * RATES.h + p * RATES.p + n * -RATES.n + p1 * RATES.p1;
}

/** How far the published speed sits from the derived one, in degrees per hour. */
export function speedResidual(constituent: Constituent): number {
  return Math.abs(constituent.speed - derivedSpeed(constituent));
}

/** Cycles per day, which is how the despatchers talk about a constituent. */
export function cyclesPerDay(constituent: Constituent): number {
  return (constituent.speed * 24) / 360;
}

export function periodHours(constituent: Constituent): number {
  if (constituent.speed === 0) {
    throw new Error(`${constituent.name} has no period`);
  }
  return 360 / constituent.speed;
}
