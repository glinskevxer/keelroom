import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_USAGE } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

async function place(draught = '10.00', vessel = '9074729', to = 'GRAIN-3'): Promise<string> {
  const result = await harness!.invoke(
    'orders',
    'place',
    vessel,
    'SEAWAY',
    '--kind',
    'arrival',
    '--from',
    'SEA',
    '--to',
    to,
    '--draught',
    draught,
    '--at',
    '2025-04-03T06:00',
  );
  return /M-\d{4}-\d{4}/.exec(result.io.text())?.[0] ?? '';
}

describe('showing a plan', () => {
  it('prints the windows and the working', async () => {
    harness = cliHarness();
    const reference = await place();
    const result = await harness.invoke('plan', 'show', reference);
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('controlling reach');
    expect(result.io.text()).toContain('what each reach asks for');
  });

  it('takes the weather into account', async () => {
    harness = cliHarness();
    const reference = await place('12.00');
    const fair = await harness.invoke('plan', 'show', reference);
    const rough = await harness.invoke(
      'plan',
      'show',
      reference,
      '--swell',
      '3.00',
      '--wind',
      '25',
    );
    expect(rough.io.text()).not.toBe(fair.io.text());
  });

  it('blocks on weather over the ceiling', async () => {
    harness = cliHarness();
    const reference = await place();
    const result = await harness.invoke('plan', 'show', reference, '--wind', '45');
    expect(result.io.text()).toContain('RES-WIND-05');
  });

  it('reads as json', async () => {
    harness = cliHarness();
    const reference = await place();
    const result = await harness.invoke('--format', 'json', 'plan', 'show', reference);
    const parsed = JSON.parse(result.io.text());
    expect(parsed.reference).toBe(reference);
    expect(Array.isArray(parsed.windows)).toBe(true);
  });

  it('refuses hours that are not a number', async () => {
    harness = cliHarness();
    const reference = await place();
    const result = await harness.invoke('plan', 'show', reference, '--hours', 'many');
    expect(result.code).toBe(EXIT_USAGE);
  });
});

describe('confirming', () => {
  it('confirms against the best window', async () => {
    harness = cliHarness();
    const reference = await place();
    const result = await harness.invoke('plan', 'confirm', reference);
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('confirmed for');
    const shown = await harness.invoke('orders', 'show', reference);
    expect(shown.io.text()).toContain('status       confirmed');
  });

  it('refuses a start outside every window', async () => {
    harness = cliHarness();
    const reference = await place();
    const result = await harness.invoke('plan', 'confirm', reference, '--at', '2025-04-10T06:00');
    expect(result.io.errorText()).toContain('not inside any window');
  });

  it('refuses a movement no tide will take', async () => {
    harness = cliHarness();
    const reference = await place('20.00', '9319466', 'ANCH-A');
    const result = await harness.invoke('plan', 'confirm', reference);
    expect(result.io.errorText()).toContain('no window to confirm against');
  });
});

describe('the sweep', () => {
  it('gives a headline for everything unplanned', async () => {
    harness = cliHarness();
    const first = await place();
    await place('9.00');
    const result = await harness.invoke('plan', 'sweep', '--days', '3');
    expect(result.io.text()).toContain(first);
    expect(result.io.text().split('\n')).toHaveLength(2);
  });

  it('leaves out what has been confirmed', async () => {
    harness = cliHarness();
    const reference = await place();
    await harness.invoke('plan', 'confirm', reference);
    const result = await harness.invoke('plan', 'sweep', '--days', '3');
    expect(result.io.text()).toBe('nothing waiting to be planned');
  });
});
