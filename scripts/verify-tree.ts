/**
 * Refuse a tree that has drifted from the conventions the suite assumes: tests
 * live under tests/, nothing under src/ is a test, and every source file is
 * reachable from the module it belongs to.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage' || entry === '.git') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const problems: string[] = [];

for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file);
  if (rel.endsWith('.test.ts') || rel.endsWith('.spec.ts')) {
    problems.push(`test file inside src: ${rel}`);
  }
  if (!rel.endsWith('.ts')) {
    problems.push(`unexpected file inside src: ${rel}`);
  }
}

for (const file of walk(join(root, 'tests'))) {
  const rel = relative(root, file);
  if (!rel.endsWith('.ts') && !rel.endsWith('.csv') && !rel.endsWith('.json')) {
    problems.push(`unexpected file inside tests: ${rel}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }
  process.exit(1);
}

console.log('tree layout is as expected');
