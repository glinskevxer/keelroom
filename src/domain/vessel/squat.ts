/**
 * Squat: how much deeper a ship sits because she is moving.
 *
 * This is the term that makes the required depth depend on the plan rather than
 * on the ship. A ship that runs the bar at twelve knots needs materially more
 * water than the same ship at eight, and how much more depends on how much of
 * the channel her hull blocks, which depends on the state of tide, which is
 * what the sweep is trying to decide. The planner therefore fixes a speed, and
 * a squat computed at one speed may not be used at another.
 *
 * Two formulas are carried. Barrass is the one the district's rules name, and
 * Millward is kept for the deep draught cases where the two disagree, because
 * the standing instruction is to take the worse of the two over a blockage of
 * one in five.
 */

import { InputError } from '../../util/errors';
import type { Cm } from '../../util/units';
import { roundHalf } from '../../util/units';
import type { ChannelType } from '../chart/reach';
import type { Vessel } from './vessel';

export type SquatMethod = 'barrass' | 'millward' | 'worse-of-both';

export interface SquatInput {
  readonly vessel: Vessel;
  /** Draught the ship is presented at, in centimetres. */
  readonly draught: Cm;
  /** Speed through the water, in tenths of a knot. */
  readonly speed: number;
  /** Water depth under the keel band, in centimetres, at the state of tide. */
  readonly depth: Cm;
  /** Width of the channel at that depth, in metres. */
  readonly width: number;
  readonly channel: ChannelType;
}

export interface SquatResult {
  readonly method: SquatMethod;
  /** Squat at the bow, in centimetres. */
  readonly squat: Cm;
  /** Blockage factor in thousandths. */
  readonly blockage: number;
  /** The formula's own reading, before the district's minimum is applied. */
  readonly rawSquat: number;
}

/**
 * Fraction of the channel cross section the hull takes up, in thousandths. An
 * open sea passage has a blockage of nothing; a canal can be a third or more.
 */
export function blockageFactor(input: SquatInput): number {
  const shipArea = (input.draught / 100) * (input.vessel.beam / 100);
  const channelArea = (input.depth / 100) * input.width;
  if (channelArea <= 0) {
    throw new InputError('a channel with no cross section cannot be transited');
  }
  return roundHalf((shipArea / channelArea) * 1000);
}

/**
 * Barrass. In open water where the hull blocks less than a tenth of the section
 * the squat is the block coefficient times the square of the speed over a
 * hundred. Anywhere the channel is confined the blockage factor itself enters,
 * raised to the power 0.81, and the speed exponent goes to 2.08.
 */
export function barrassSquat(input: SquatInput): number {
  const knots = input.speed / 10;
  if (knots <= 0) {
    throw new InputError('a ship that is not moving has no squat to compute');
  }
  const blockage = blockageFactor(input);
  const cb = input.vessel.blockCoefficient / 1000;
  const openWater = (cb * knots * knots) / 100;
  if (input.channel === 'open' && blockage < 100) {
    return openWater;
  }
  const fraction = blockage / 1000;
  const confined = (cb * Math.pow(fraction, 0.81) * Math.pow(knots, 2.08)) / 20;
  // the blockage form is fitted to confined water and reads low where there is
  // hardly any blockage at all, so a confined reach never comes out better than
  // the same ship in the open
  return Math.max(openWater, confined);
}

/**
 * Millward, in the form the district's standing orders quote it, where the
 * squat comes out as a percentage of the ship's length and the froude depth
 * number carries the shallow water effect. It runs away as the froude number
 * approaches unity, which is the behaviour Barrass does not have and the reason
 * both are carried.
 */
export function millwardSquat(input: SquatInput): number {
  const knots = input.speed / 10;
  if (knots <= 0) {
    throw new InputError('a ship that is not moving has no squat to compute');
  }
  const depthMetres = input.depth / 100;
  if (depthMetres <= 0) {
    throw new InputError('a channel with no depth cannot be transited');
  }
  const speedMetres = knots * 0.5144;
  const froude = speedMetres / Math.sqrt(9.81 * depthMetres);
  if (froude >= 0.9) {
    throw new InputError(
      `a froude depth number of ${froude.toFixed(2)} is outside anything the formula covers`,
    );
  }
  const cb = input.vessel.blockCoefficient / 1000;
  const lengthMetres = input.vessel.length / 100;
  const ratio = (cb * (input.vessel.beam / 100)) / lengthMetres;
  const percentOfLength = (15 * ratio * froude * froude) / (1 - froude);
  return (percentOfLength * lengthMetres) / 100;
}

/** The district's floor: any moving ship is credited with at least five centimetres. */
const MINIMUM_SQUAT = 5;

/**
 * Under this much water for her draught a ship is planned on the worse of the
 * two formulas whatever the blockage, because Barrass alone does not carry the
 * shallow water effect.
 */
const SHALLOW_RATIO = 1.3;

export function computeSquat(
  input: SquatInput,
  method: SquatMethod = 'worse-of-both',
): SquatResult {
  const blockage = blockageFactor(input);
  let raw: number;
  let used: SquatMethod = method;
  switch (method) {
    case 'barrass':
      raw = barrassSquat(input);
      break;
    case 'millward':
      raw = millwardSquat(input);
      break;
    case 'worse-of-both': {
      const barrass = barrassSquat(input);
      const shallow = input.depth < input.draught * SHALLOW_RATIO;
      if (blockage < 200 && !shallow) {
        raw = barrass;
        used = 'barrass';
        break;
      }
      const millward = millwardSquat(input);
      raw = Math.max(barrass, millward);
      used = millward > barrass ? 'millward' : 'barrass';
      break;
    }
  }
  return {
    method: used,
    blockage,
    rawSquat: raw * 100,
    squat: Math.max(MINIMUM_SQUAT, roundHalf(raw * 100)),
  };
}

/**
 * The fastest whole tenth of a knot that keeps squat inside a limit. Squat rises
 * faster than linearly with speed, so this is a search rather than a division.
 */
export function fastestSpeedWithin(
  input: Omit<SquatInput, 'speed'>,
  limit: Cm,
  ceilingSpeed: number,
): number | undefined {
  if (!Number.isInteger(ceilingSpeed) || ceilingSpeed <= 0) {
    throw new InputError('the ceiling speed must be whole tenths of a knot');
  }
  for (let speed = ceilingSpeed; speed >= 10; speed -= 1) {
    try {
      const result = computeSquat({ ...input, speed });
      if (result.squat <= limit) {
        return speed;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}
