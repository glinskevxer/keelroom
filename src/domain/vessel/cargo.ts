/**
 * What she is carrying, when it matters.
 *
 * The ship's type is a rough guide and the declaration is the fact: a general
 * cargo ship with forty tonnes of class 1 aboard is handled like an explosives
 * carrier, and a tanker in ballast is not handled like a loaded one. The
 * district takes a declaration per movement rather than per ship for exactly
 * that reason.
 */

import { InputError } from '../../util/errors';

/** The imdg classes, as the declaration form numbers them. */
export type HazardClass = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'none';

export interface CargoDeclaration {
  readonly movement: string;
  readonly hazard: HazardClass;
  /** The un number, where the declaration carries one. */
  readonly unNumber?: string;
  readonly tonnes: number;
  /** Whether she is in ballast, which takes the cargo rules off entirely. */
  readonly inBallast: boolean;
  readonly note?: string;
}

const CLASSES: readonly HazardClass[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'none'];
const UN_NUMBER = /^\d{4}$/;

export function isHazardClass(candidate: string): candidate is HazardClass {
  return (CLASSES as readonly string[]).includes(candidate);
}

export function hazardClasses(): readonly HazardClass[] {
  return CLASSES;
}

export function makeDeclaration(input: {
  movement: string;
  hazard: string;
  unNumber?: string;
  tonnes?: number;
  inBallast?: boolean;
  note?: string;
}): CargoDeclaration {
  if (!isHazardClass(input.hazard)) {
    throw new InputError(`${input.hazard} is not a hazard class the form carries`);
  }
  if (input.unNumber !== undefined && !UN_NUMBER.test(input.unNumber)) {
    throw new InputError(`${input.unNumber} is not a un number`);
  }
  const tonnes = input.tonnes ?? 0;
  if (!Number.isInteger(tonnes) || tonnes < 0) {
    throw new InputError('a declaration carries whole tonnes or none');
  }
  const inBallast = input.inBallast ?? false;
  if (inBallast && input.hazard !== 'none') {
    throw new InputError('a ship in ballast is not carrying anything to declare');
  }
  return {
    movement: input.movement,
    hazard: input.hazard,
    ...(input.unNumber === undefined ? {} : { unNumber: input.unNumber }),
    tonnes,
    inBallast,
    ...(input.note === undefined ? {} : { note: input.note.trim() }),
  };
}

/** The classes the district treats as dangerous for the clearance rules. */
const DANGEROUS: readonly HazardClass[] = ['1', '2', '3', '4', '5', '6', '7', '8'];

export function isDangerous(declaration: CargoDeclaration | undefined): boolean {
  if (declaration === undefined || declaration.inBallast) {
    return false;
  }
  return DANGEROUS.includes(declaration.hazard);
}

/** Explosives and radioactives, which the standing orders single out. */
export function needsEscort(declaration: CargoDeclaration | undefined): boolean {
  if (declaration === undefined || declaration.inBallast) {
    return false;
  }
  return declaration.hazard === '1' || declaration.hazard === '7';
}

/** Class 1 moves in daylight, whatever the ship's size. */
export function forcesDaylight(declaration: CargoDeclaration | undefined): boolean {
  return declaration !== undefined && !declaration.inBallast && declaration.hazard === '1';
}

/** Tugs the cargo adds on top of what the ship's size wants. */
export function extraTugs(declaration: CargoDeclaration | undefined): number {
  if (declaration === undefined || declaration.inBallast) {
    return 0;
  }
  if (declaration.hazard === '1') {
    return 2;
  }
  return isDangerous(declaration) ? 1 : 0;
}

export function describeDeclaration(declaration: CargoDeclaration): string {
  if (declaration.inBallast) {
    return `${declaration.movement}: in ballast`;
  }
  const un = declaration.unNumber === undefined ? '' : ` un ${declaration.unNumber}`;
  const tonnes = declaration.tonnes === 0 ? '' : `, ${declaration.tonnes} t`;
  return `${declaration.movement}: class ${declaration.hazard}${un}${tonnes}`;
}
