/**
 * Things that have to be true of the package before it is worth building.
 *
 * Every dependency pinned to one version, because a range means the district
 * that installs it in March and the district that installs it in October are
 * running different code and only one of them was tested. The rest are the
 * mistakes that have actually happened here: a bin pointing at a file the build
 * does not produce, an engines field that drifted from the version CI runs, and
 * a source file importing something that only exists in development.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly main: string;
  readonly bin: Record<string, string>;
  readonly engines: Record<string, string>;
  readonly files: string[];
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly scripts: Record<string, string>;
}

const EXACT = /^\d+\.\d+\.\d+$/;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The version being built has to be the top entry in the changelog, and it has
 * to say something. A release nobody wrote a line about is a release nobody can
 * tell from the one before it.
 */
export function changelogProblems(version: string): string[] {
  const path = join(root, 'CHANGELOG.md');
  if (!existsSync(path)) {
    return ['CHANGELOG.md is missing'];
  }
  const text = readFileSync(path, 'utf8');
  const headings = [...text.matchAll(/^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/gm)];
  if (headings.length === 0) {
    return ['the changelog has no version headings'];
  }
  const problems: string[] = [];
  const top = headings[0];
  if (top?.[1] !== version) {
    problems.push(
      `the changelog's top entry is ${top?.[1] ?? 'nothing'} and the package is ${version}`,
    );
  }
  const versions = headings.map((heading) => heading[1] ?? '');
  if (new Set(versions).size !== versions.length) {
    problems.push('the changelog carries a version twice');
  }
  const body = text.slice(text.indexOf(top?.[0] ?? '') + (top?.[0]?.length ?? 0));
  const next = body.indexOf('\n## ');
  const entry = next < 0 ? body : body.slice(0, next);
  if (entry.trim().length < 80) {
    problems.push(`the changelog entry for ${version} says almost nothing`);
  }
  return problems;
}

function main(): void {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
  const problems: string[] = [];

  for (const [name, range] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    if (!EXACT.test(range)) {
      problems.push(`${name} is not pinned to one version: ${range}`);
    }
  }

  if (manifest.engines.node === undefined) {
    problems.push('there is no engines.node');
  }
  if (!manifest.files.includes('dist')) {
    problems.push('the files list does not carry dist');
  }
  for (const [command, path] of Object.entries(manifest.bin)) {
    if (!path.startsWith('dist/')) {
      problems.push(`the ${command} bin does not point into dist: ${path}`);
    }
  }
  if (!manifest.main.startsWith('dist/')) {
    problems.push(`main does not point into dist: ${manifest.main}`);
  }
  for (const script of ['build', 'test', 'lint', 'typecheck', 'coverage']) {
    if (manifest.scripts[script] === undefined) {
      problems.push(`there is no ${script} script`);
    }
  }

  const devNames = Object.keys(manifest.devDependencies);
  for (const file of sourceFiles(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const name of devNames) {
      const pattern = new RegExp(`from '${name}(/|')`);
      if (pattern.test(text)) {
        problems.push(`${file.slice(root.length + 1)} imports the development package ${name}`);
      }
    }
  }

  for (const path of [
    'README.md',
    'CHANGELOG.md',
    'docs/commands.md',
    'docs/rules.md',
    'docs/api.md',
    'src/version.ts',
  ]) {
    if (!existsSync(join(root, path))) {
      problems.push(`${path} is missing`);
    }
  }

  problems.push(...changelogProblems(manifest.version));

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(problem);
    }
    process.exit(1);
  }
  console.log(`${manifest.name} ${manifest.version} is ready to build`);
}

main();
