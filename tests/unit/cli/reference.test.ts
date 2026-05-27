import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildProgram } from '../../../src/cli/program';
import { recordingIo } from '../../../src/cli/output';
import { run } from '../../../src/cli/program';

const reference = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'commands.md'), 'utf8');

function commandNames(): string[] {
  const program = buildProgram(recordingIo());
  const names: string[] = [];
  const walk = (command: ReturnType<typeof buildProgram>, path: string[]): void => {
    for (const child of command.commands) {
      const name = [...path, child.name()].join(' ');
      names.push(name);
      walk(child as ReturnType<typeof buildProgram>, [...path, child.name()]);
    }
  };
  walk(program, []);
  return names;
}

describe('the command tree', () => {
  it('carries every group the district uses', () => {
    const names = commandNames();
    for (const group of [
      'orders',
      'plan',
      'dispatch',
      'billing',
      'district',
      'vessels',
      'agents',
      'pilots',
      'tides',
      'board',
      'doctor',
      'serve',
    ]) {
      expect(names).toContain(group);
    }
  });

  it('gives every command a description', () => {
    const program = buildProgram(recordingIo());
    const walk = (command: ReturnType<typeof buildProgram>): void => {
      for (const child of command.commands) {
        expect(child.description()).not.toBe('');
        walk(child as ReturnType<typeof buildProgram>);
      }
    };
    walk(program);
  });

  it('has no two commands with the same name in one group', () => {
    const program = buildProgram(recordingIo());
    const walk = (command: ReturnType<typeof buildProgram>): void => {
      const names = command.commands.map((child) => child.name());
      expect(new Set(names).size).toBe(names.length);
      for (const child of command.commands) {
        walk(child as ReturnType<typeof buildProgram>);
      }
    };
    walk(program);
  });
});

describe('the generated reference', () => {
  it('names every command', () => {
    for (const name of commandNames()) {
      expect(reference).toContain(`\`keelroom ${name}\``);
    }
  });

  it('says it is generated', () => {
    expect(reference).toContain('Do not edit by hand');
  });

  it('lists the options that appear on every command', () => {
    expect(reference).toContain('--district <code>');
    expect(reference).toContain('--format <format>');
  });
});

describe('the help text', () => {
  it('shows the ordinary day in the order it happens', async () => {
    const io = recordingIo();
    await run(['--help'], { io });
    const text = io.text();
    expect(text).toContain('The ordinary day');
    expect(text.indexOf('orders place')).toBeLessThan(text.indexOf('plan confirm'));
    expect(text.indexOf('plan confirm')).toBeLessThan(text.indexOf('dispatch assign'));
    expect(text.indexOf('dispatch assign')).toBeLessThan(text.indexOf('billing raise'));
  });

  it('names the pages read every morning', async () => {
    const io = recordingIo();
    await run(['--help'], { io });
    expect(io.text()).toContain('keelroom bulletin');
    expect(io.text()).toContain('keelroom doctor');
  });
});
