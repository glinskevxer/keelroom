import { afterEach, describe, expect, it } from 'vitest';
import { placeOrder } from '../../../src/service/ordering';
import { planMovement } from '../../../src/service/planning';
import {
  planHeadline,
  renderFindings,
  renderPlan,
  renderReachDemands,
  renderWindows,
  summarise,
} from '../../../src/report/plan';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

const OPTIONS = { offset: -240 };

function planFor(
  draught: number,
  vessel = '9074729',
  to = 'GRAIN-3',
): ReturnType<typeof planMovement> {
  const context = harness!.context;
  const reference = placeOrder(context, {
    kind: 'arrival',
    vessel,
    agent: 'SEAWAY',
    from: 'SEA',
    to,
    draught,
    requestedFor: NOW + 2880,
  }).movement.reference;
  return planMovement(context, { reference });
}

describe('the windows table', () => {
  it('has a row for every window', () => {
    harness = testContext();
    const plan = planFor(1000);
    const text = renderWindows(plan.result, OPTIONS);
    expect(text.split('\n')).toHaveLength(3 + plan.result.windows.length);
  });

  it('says so when there is none', () => {
    harness = testContext();
    const plan = planFor(2000, '9319466', 'ANCH-A');
    expect(renderWindows(plan.result, OPTIONS)).toContain('no window in the range');
  });
});

describe('what each reach asks for', () => {
  it('lists the reaches and their demands', () => {
    harness = testContext();
    const text = renderReachDemands(planFor(1000).result);
    expect(text).toContain('LOWER-BAR');
    expect(text).toContain('APPROACH');
  });

  it('shows a demand no tide in the range can meet', () => {
    harness = testContext();
    const plan = planFor(2000, '9319466', 'ANCH-A');
    expect(renderReachDemands(plan.result)).toContain('APPROACH');
    expect(plan.result.windows).toEqual([]);
  });
});

describe('the summary', () => {
  it('names the controlling reach and the tugs', () => {
    harness = testContext();
    const text = summarise(planFor(1000).result, OPTIONS);
    expect(text).toContain('controlling reach');
    expect(text).toContain('LOWER-BAR');
    expect(text).toContain('tugs');
  });

  it('names the tightest structure where there is one', () => {
    harness = testContext();
    expect(summarise(planFor(1000).result, OPTIONS)).toContain('HARBOUR-BR');
  });

  it('gives the first window when there is one', () => {
    harness = testContext();
    const plan = planFor(1000);
    const text = summarise(plan.result, OPTIONS);
    expect(text).toContain('first window');
  });

  it('leaves the first window out when there is none', () => {
    harness = testContext();
    const text = summarise(planFor(2000, '9319466', 'ANCH-A').result, OPTIONS);
    expect(text).not.toContain('first window');
  });
});

describe('the findings', () => {
  it('read as nothing when the plan is clean', () => {
    harness = testContext();
    expect(renderFindings(planFor(600, '9074705').result)).toBe('nothing to report');
  });

  it('list the rules that fired', () => {
    harness = testContext();
    const text = renderFindings(planFor(2000, '9319466', 'ANCH-A').result);
    expect(text).toContain('WIN-NONE-02');
  });
});

describe('the whole report and the headline', () => {
  it('puts the summary first and the findings last', () => {
    harness = testContext();
    const text = renderPlan(planFor(1000).result, OPTIONS);
    expect(text.split('\n')[0]).toContain('windows');
    expect(text).toContain('what each reach asks for');
  });

  it('reads as one line for a list', () => {
    harness = testContext();
    expect(planHeadline(planFor(1000).result, OPTIONS)).toMatch(/windows?, first \d\d:\d\d for/);
  });

  it('names the rule in the headline when there is no window', () => {
    harness = testContext();
    const line = planHeadline(planFor(2000, '9319466', 'ANCH-A').result, OPTIONS);
    expect(line).toContain('no window');
    expect(line).toContain('WIN-NONE-02');
  });
});
