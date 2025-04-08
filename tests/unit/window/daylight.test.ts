import { describe, expect, it } from 'vitest';
import { formatLocal, parseInstant, parseLocal } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeInterval } from '../../../src/util/interval';
import {
  dayLength,
  daylightWindows,
  isDaylight,
  makePosition,
  solarPosition,
  sunTimes,
} from '../../../src/domain/window/daylight';

const PORT = makePosition(44.65, -63.57);
const OFFSET = -240;

describe('a position', () => {
  it('takes a place on the earth', () => {
    expect(makePosition(0, 0)).toEqual({ latitude: 0, longitude: 0 });
    expect(PORT.latitude).toBeCloseTo(44.65, 6);
  });

  it('refuses one that is not', () => {
    expect(() => makePosition(95, 0)).toThrow(/not on the earth/);
    expect(() => makePosition(0, 200)).toThrow(InputError);
    expect(() => makePosition(Number.NaN, 0)).toThrow(InputError);
  });
});

describe('the sun', () => {
  it('is furthest north in june and furthest south in december', () => {
    const june = solarPosition(parseInstant('2025-06-21T12:00Z'));
    const december = solarPosition(parseInstant('2025-12-21T12:00Z'));
    expect(june.declination).toBeCloseTo(23.4, 0);
    expect(december.declination).toBeCloseTo(-23.4, 0);
  });

  it('crosses the equator at the equinoxes', () => {
    const march = solarPosition(parseInstant('2025-03-20T12:00Z'));
    expect(Math.abs(march.declination)).toBeLessThan(1);
  });

  it('runs the equation of time inside twenty minutes either way', () => {
    for (const date of ['2025-02-11', '2025-05-14', '2025-07-26', '2025-11-03']) {
      const { equationOfTime } = solarPosition(parseInstant(`${date}T12:00Z`));
      expect(Math.abs(equationOfTime)).toBeLessThan(20);
    }
  });
});

describe('sunrise and sunset', () => {
  it('gives a summer day of about fifteen hours at this latitude', () => {
    const length = dayLength(PORT, parseLocal('2025-06-21T12:00', OFFSET), OFFSET);
    expect(length).toBeGreaterThan(880);
    expect(length).toBeLessThan(950);
  });

  it('gives a winter day of about nine', () => {
    const length = dayLength(PORT, parseLocal('2025-12-21T12:00', OFFSET), OFFSET);
    expect(length).toBeGreaterThan(510);
    expect(length).toBeLessThan(560);
  });

  it('puts sunrise before sunset on the same local day', () => {
    const times = sunTimes(PORT, parseLocal('2025-04-01T12:00', OFFSET), OFFSET)!;
    expect(times.sunrise).toBeLessThan(times.sunset);
    expect(formatLocal(times.sunrise, OFFSET)).toContain('2025-04-01');
    expect(formatLocal(times.sunset, OFFSET)).toContain('2025-04-01');
  });

  it('gives nothing at all in the polar night', () => {
    const north = makePosition(78, 15);
    expect(sunTimes(north, parseLocal('2025-12-21T12:00', 60), 60)).toBeUndefined();
    expect(dayLength(north, parseLocal('2025-12-21T12:00', 60), 60)).toBe(0);
    expect(isDaylight(north, parseLocal('2025-12-21T12:00', 60), 60)).toBe(false);
  });

  it('agrees with the almanac for the district, which keeps standard time all year', () => {
    const times = sunTimes(PORT, parseLocal('2025-06-21T12:00', OFFSET), OFFSET)!;
    const sunrise = formatLocal(times.sunrise, OFFSET).slice(11);
    const sunset = formatLocal(times.sunset, OFFSET).slice(11);
    expect(sunrise >= '04:20' && sunrise <= '04:40').toBe(true);
    expect(sunset >= '19:55' && sunset <= '20:15').toBe(true);
  });
});

describe('daylight windows', () => {
  const bounds = makeInterval(
    parseLocal('2025-04-01T00:00', OFFSET),
    parseLocal('2025-04-04T00:00', OFFSET),
  );

  it('gives one window a day inside the range', () => {
    const windows = daylightWindows(PORT, bounds, OFFSET);
    expect(windows.length).toBeGreaterThanOrEqual(3);
    expect(windows.length).toBeLessThanOrEqual(4);
  });

  it('keeps them inside the range', () => {
    for (const window of daylightWindows(PORT, bounds, OFFSET)) {
      expect(window.from).toBeGreaterThanOrEqual(bounds.from);
      expect(window.to).toBeLessThanOrEqual(bounds.to);
    }
  });

  it('widens them by the twilight the orders allow', () => {
    const plain = daylightWindows(PORT, bounds, OFFSET);
    const wide = daylightWindows(PORT, bounds, OFFSET, { before: 30, after: 30 });
    const total = (windows: typeof plain): number =>
      windows.reduce((sum, window) => sum + (window.to - window.from), 0);
    expect(total(wide)).toBeGreaterThan(total(plain));
  });

  it('agrees with the moment by moment test', () => {
    const windows = daylightWindows(PORT, bounds, OFFSET);
    const inside = windows[0]!.from + 60;
    expect(isDaylight(PORT, inside, OFFSET)).toBe(true);
    expect(isDaylight(PORT, windows[0]!.to + 90, OFFSET)).toBe(false);
  });

  it('refuses a range that ends before it starts', () => {
    expect(() => daylightWindows(PORT, { from: bounds.to, to: bounds.from }, OFFSET)).toThrow(
      InputError,
    );
  });
});
