import { describe, expect, it } from 'vitest';
import {
  blocking,
  describeFinding,
  FindingLog,
  isClear,
  makeFinding,
  sortFindings,
} from '../../../src/util/finding';

describe('making a finding', () => {
  it('keeps the rule id it was given', () => {
    const finding = makeFinding('UKC-NET-01', 'block', 'not enough water');
    expect(finding.rule).toBe('UKC-NET-01');
    expect(finding.severity).toBe('block');
    expect(finding.subject).toBeUndefined();
  });

  it('carries a subject and detail when given them', () => {
    const finding = makeFinding('UKC-NET-01', 'block', 'not enough water', {
      subject: 'LOWER-BAR',
      detail: { shortBy: 40 },
    });
    expect(finding.subject).toBe('LOWER-BAR');
    expect(finding.detail).toEqual({ shortBy: 40 });
  });

  it('refuses a rule id that is not one', () => {
    expect(() => makeFinding('ukc-1', 'block', 'x')).toThrow(/not a rule id/);
    expect(() => makeFinding('UKC', 'block', 'x')).toThrow(/not a rule id/);
    expect(() => makeFinding('UKC-NET-01-EXTRA-MORE', 'block', 'x')).toThrow(/not a rule id/);
  });

  it('copies the detail rather than holding the caller object', () => {
    const detail = { shortBy: 40 };
    const finding = makeFinding('UKC-NET-01', 'block', 'x', { detail });
    detail.shortBy = 0;
    expect(finding.detail).toEqual({ shortBy: 40 });
  });
});

describe('ordering', () => {
  const findings = [
    makeFinding('TAR-NIGHT-02', 'info', 'night rate applies'),
    makeFinding('UKC-NET-01', 'block', 'not enough water', { subject: 'B' }),
    makeFinding('UKC-NET-01', 'block', 'not enough water', { subject: 'A' }),
    makeFinding('ROS-REST-03', 'advice', 'pilot is close to the rest limit'),
  ];

  it('puts blocking findings first and then sorts by rule', () => {
    const sorted = sortFindings(findings);
    expect(sorted.map((finding) => finding.rule)).toEqual([
      'UKC-NET-01',
      'UKC-NET-01',
      'ROS-REST-03',
      'TAR-NIGHT-02',
    ]);
    expect(sorted[0]?.subject).toBe('A');
  });

  it('does not disturb the input', () => {
    const before = findings.map((finding) => finding.rule);
    sortFindings(findings);
    expect(findings.map((finding) => finding.rule)).toEqual(before);
  });

  it('reads clear only when nothing blocks', () => {
    expect(isClear(findings)).toBe(false);
    expect(blocking(findings)).toHaveLength(2);
    expect(isClear(findings.filter((finding) => finding.severity !== 'block'))).toBe(true);
    expect(isClear([])).toBe(true);
  });

  it('describes a finding with its rule and subject', () => {
    expect(describeFinding(findings[1]!)).toBe('[UKC-NET-01] B not enough water');
    expect(describeFinding(findings[0]!)).toBe('[TAR-NIGHT-02] night rate applies');
  });
});

describe('the log', () => {
  it('collects in the order things were added', () => {
    const log = new FindingLog();
    log.note('TAR-NIGHT-02', 'night rate applies');
    log.block('UKC-NET-01', 'not enough water', { subject: 'BAR' });
    log.advise('ROS-REST-03', 'close to the rest limit');
    expect(log.size).toBe(3);
    expect(log.all().map((finding) => finding.severity)).toEqual(['info', 'block', 'advice']);
    expect(log.sorted()[0]?.rule).toBe('UKC-NET-01');
  });

  it('reports whether it is clear', () => {
    const log = new FindingLog();
    expect(log.clear()).toBe(true);
    log.advise('ROS-REST-03', 'close to the rest limit');
    expect(log.clear()).toBe(true);
    log.block('UKC-NET-01', 'not enough water');
    expect(log.clear()).toBe(false);
  });

  it('answers whether a rule fired', () => {
    const log = new FindingLog().block('UKC-NET-01', 'not enough water');
    expect(log.has('UKC-NET-01')).toBe(true);
    expect(log.has('UKC-GROSS-02')).toBe(false);
  });

  it('takes findings from another pass', () => {
    const first = new FindingLog().block('UKC-NET-01', 'a');
    const second = new FindingLog().addAll(first.all()).note('TAR-NIGHT-02', 'b');
    expect(second.size).toBe(2);
    expect(second.all()[0]?.rule).toBe('UKC-NET-01');
  });

  it('hands out a copy of its entries', () => {
    const log = new FindingLog().block('UKC-NET-01', 'a');
    log.all().push(makeFinding('TAR-NIGHT-02', 'info', 'b'));
    expect(log.size).toBe(1);
  });
});
