/**
 * A finding is what a rule produces when it fires. Every rule in the system has
 * a stable id, and nothing may report a problem without one, because the
 * reports are read against the published rule book rather than against this
 * code.
 */

export type Severity = 'info' | 'advice' | 'block';

export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
  readonly subject?: string;
  readonly detail?: Readonly<Record<string, string | number>>;
}

const RULE_ID = /^[A-Z]{2,8}(-[A-Z0-9]{1,6}){1,3}$/;

export function makeFinding(
  rule: string,
  severity: Severity,
  message: string,
  extra: { subject?: string; detail?: Record<string, string | number> } = {},
): Finding {
  if (!RULE_ID.test(rule)) {
    throw new Error(`not a rule id: ${JSON.stringify(rule)}`);
  }
  const finding: Finding = {
    rule,
    severity,
    message,
    ...(extra.subject === undefined ? {} : { subject: extra.subject }),
    ...(extra.detail === undefined ? {} : { detail: { ...extra.detail } }),
  };
  return finding;
}

const RANK: Record<Severity, number> = { block: 0, advice: 1, info: 2 };

/** Blocking first, then by rule id, so two runs of the same case read alike. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      a.rule.localeCompare(b.rule) ||
      (a.subject ?? '').localeCompare(b.subject ?? '') ||
      a.message.localeCompare(b.message),
  );
}

export function blocking(findings: readonly Finding[]): Finding[] {
  return findings.filter((finding) => finding.severity === 'block');
}

export function isClear(findings: readonly Finding[]): boolean {
  return blocking(findings).length === 0;
}

export function describeFinding(finding: Finding): string {
  const subject = finding.subject === undefined ? '' : ` ${finding.subject}`;
  return `[${finding.rule}]${subject} ${finding.message}`;
}

/** Collect findings from several rule passes without losing their order. */
export class FindingLog {
  private readonly entries: Finding[] = [];

  add(finding: Finding): this {
    this.entries.push(finding);
    return this;
  }

  addAll(findings: readonly Finding[]): this {
    for (const finding of findings) {
      this.entries.push(finding);
    }
    return this;
  }

  block(
    rule: string,
    message: string,
    extra?: { subject?: string; detail?: Record<string, string | number> },
  ): this {
    return this.add(makeFinding(rule, 'block', message, extra));
  }

  advise(
    rule: string,
    message: string,
    extra?: { subject?: string; detail?: Record<string, string | number> },
  ): this {
    return this.add(makeFinding(rule, 'advice', message, extra));
  }

  note(
    rule: string,
    message: string,
    extra?: { subject?: string; detail?: Record<string, string | number> },
  ): this {
    return this.add(makeFinding(rule, 'info', message, extra));
  }

  all(): Finding[] {
    return [...this.entries];
  }

  sorted(): Finding[] {
    return sortFindings(this.entries);
  }

  clear(): boolean {
    return isClear(this.entries);
  }

  get size(): number {
    return this.entries.length;
  }

  has(rule: string): boolean {
    return this.entries.some((finding) => finding.rule === rule);
  }
}
