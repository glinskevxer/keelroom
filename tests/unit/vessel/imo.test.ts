import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { formatImo, imoCheckDigit, isValidImo, normaliseImo } from '../../../src/domain/vessel/imo';

describe('the check digit', () => {
  it('computes the published example', () => {
    expect(imoCheckDigit('907472')).toBe(9);
  });

  it('refuses anything that is not six digits', () => {
    expect(() => imoCheckDigit('90704')).toThrow(InputError);
    expect(() => imoCheckDigit('90704a')).toThrow(/six digits/);
  });
});

describe('validating', () => {
  it('takes a good number in any of the forms an agent writes it', () => {
    expect(isValidImo('9074729')).toBe(true);
    expect(isValidImo('IMO 9074729')).toBe(true);
    expect(isValidImo('imo-9074729')).toBe(true);
    expect(isValidImo(' 9074729 ')).toBe(true);
  });

  it('refuses a number whose check digit is wrong', () => {
    expect(isValidImo('9074720')).toBe(false);
    expect(isValidImo('9074728')).toBe(false);
  });

  it('refuses anything of the wrong length', () => {
    expect(isValidImo('907043')).toBe(false);
    expect(isValidImo('90747295')).toBe(false);
    expect(isValidImo('')).toBe(false);
  });

  it('normalises to the seven digits', () => {
    expect(normaliseImo('IMO 9074729')).toBe('9074729');
    expect(() => normaliseImo('9074720')).toThrow(/fails its check digit/);
    expect(() => normaliseImo('nonsense')).toThrow(/not an imo number/);
  });

  it('formats with the prefix', () => {
    expect(formatImo('9074729')).toBe('IMO 9074729');
  });
});
