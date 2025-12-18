/**
 * Read npm's advisories against what actually ships.
 *
 * The rule is not "no advisories". It is that every advisory against a runtime
 * dependency has been read by somebody, judged against how this system is
 * deployed, and written down with a date the judgement runs out. An advisory
 * nobody has read fails the build, and so does an acceptance that has expired,
 * because an acceptance with no end is the same as not looking.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

interface Advisory {
  readonly name: string;
  readonly severity: string;
  readonly via: unknown[];
  readonly isDirect: boolean;
}

interface AuditReport {
  readonly vulnerabilities?: Record<string, Advisory>;
}

interface Acceptance {
  readonly package: string;
  readonly advisory: string;
  readonly severity: string;
  readonly reason: string;
  readonly reviewedBy: string;
  readonly expires: string;
}

interface Register {
  readonly accepted: Acceptance[];
}

function readAudit(path: string): AuditReport {
  const text = readFileSync(path, 'utf8').trim();
  if (text === '') {
    return {};
  }
  return JSON.parse(text) as AuditReport;
}

function main(): void {
  const fromIndex = process.argv.indexOf('--from-audit');
  if (fromIndex < 0 || process.argv[fromIndex + 1] === undefined) {
    console.error('usage: audit-dependencies --from-audit <audit.json> [--report-only]');
    process.exit(2);
  }
  const reportOnly = process.argv.includes('--report-only');
  const audit = readAudit(process.argv[fromIndex + 1] ?? '');
  const register = JSON.parse(
    readFileSync(join(root, 'security-advisories.json'), 'utf8'),
  ) as Register;
  const vulnerabilities = Object.values(audit.vulnerabilities ?? {});

  if (vulnerabilities.length === 0) {
    console.log('no advisories against what ships');
    return;
  }

  const problems: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const advisory of vulnerabilities) {
    const accepted = register.accepted.find((entry) => entry.package === advisory.name);
    if (accepted === undefined) {
      problems.push(
        `${advisory.name} has a ${advisory.severity} advisory nobody has read; fix it or write it down`,
      );
      continue;
    }
    if (accepted.expires < today) {
      problems.push(
        `the acceptance for ${advisory.name} ran out on ${accepted.expires} and has to be read again`,
      );
      continue;
    }
    console.log(
      `${advisory.name}: ${advisory.severity}, accepted by ${accepted.reviewedBy} until ${accepted.expires}`,
    );
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(problem);
    }
    if (!reportOnly) {
      process.exit(1);
    }
  }
  console.log(`${vulnerabilities.length} advisories read, ${problems.length} unresolved`);
}

main();
